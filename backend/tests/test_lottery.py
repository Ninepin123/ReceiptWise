"""RSS 解析、對獎規則、獎號 API、開獎自動通知、CLI。"""
import json
import uuid as uuidlib
from datetime import date, datetime

import pytest

from app.models import LotteryDraw
from app.services.lottery import (
    ensure_fresh_draws,
    match_prize,
    parse_rss,
)

# 依文件第 5 節規則：XY12348835 的末 6 碼 348835 與頭獎 54348835 相同 → 三獎（NT$10,000）。
# （任務說明寫五獎，但末 6 碼相同應取較高的三獎，以 ARCHITECTURE.md 第 5 節為準。）
WINNING_NUMBER = "XY12348835"
WINNING_PRIZE = ("三獎", 10000)

# 11507 期的獎號（來自 fixture）
DRAW_11507 = {
    "special": "89996565",
    "grand": "91098182",
    "first": ["54348835", "44991397", "06595111"],
    "extra_sixth": [],
}


def put_inv(client, headers, inv_id=None, **overrides):
    payload = {
        "number": "AB00000000",
        "date": "2026-08-10",
        "amount": 120,
        "seller": "好食光便當",
        "source": "qr",
        **overrides,
    }
    return client.put(f"/api/invoices/{inv_id or uuidlib.uuid4()}", json=payload, headers=headers)


# ---------- parse_rss ----------

def test_parse_rss_fixture(rss):
    draws = parse_rss(rss)
    assert len(draws) == 6
    assert {d["period"] for d in draws} == {"11507", "11505", "11503", "11501", "11411", "11409"}

    by_period = {d["period"]: d for d in draws}
    d = by_period["11507"]
    assert d["special"] == "89996565"
    assert d["grand"] == "91098182"
    assert d["first"] == ["54348835", "44991397", "06595111"]
    assert d["extra_sixth"] == []
    assert d["published_at"] == datetime(2026, 9, 25, 5, 0, 33)


def test_parse_rss_halfwidth_and_extra_sixth():
    xml = """
    <rss version="2.0"><channel>
      <item>
        <title>115年 09~10月</title>
        <pubDate>Sun, 25 Oct 2026 05:00:00 GMT</pubDate>
        <description><![CDATA[<p>特別獎:11111111</p><p>特獎:22222222</p>
        <p>頭獎:33333333,44444444,55555555</p><p>增開六獎:666,777</p>]]></description>
      </item>
    </channel></rss>
    """
    draws = parse_rss(xml)
    assert len(draws) == 1
    d = draws[0]
    assert d["period"] == "11509"
    assert d["special"] == "11111111"
    assert d["grand"] == "22222222"
    assert d["first"] == ["33333333", "44444444", "55555555"]
    assert d["extra_sixth"] == ["666", "777"]


def test_parse_rss_skips_incomplete_item():
    xml = """
    <rss version="2.0"><channel>
      <item><title>壞掉的一期</title><description><![CDATA[<p>特別獎：11111111</p>]]></description></item>
      <item><title>115年 09~10月</title><description><![CDATA[<p>特別獎：11111111</p><p>特獎：22222222</p><p>頭獎：33333333</p>]]></description></item>
    </channel></rss>
    """
    draws = parse_rss(xml)
    assert [d["period"] for d in draws] == ["11509"]


# ---------- match_prize ----------

@pytest.mark.parametrize(
    "number,expected",
    [
        ("AB89996565", ("特別獎", 10000000)),  # 完全等於特別獎
        ("ZZ91098182", ("特獎", 2000000)),  # 完全等於特獎
        ("AB54348835", ("頭獎", 200000)),  # 完全等於頭獎
        ("AB14348835", ("二獎", 40000)),  # 末 7 碼
        ("AB12348835", ("三獎", 10000)),  # 末 6 碼
        ("AB99888835", ("五獎", 1000)),  # 末 4 碼（末 5 碼不同）
        ("AB12342111", ("六獎", 200)),  # 末 3 碼（末 4 碼不同）
        ("AB00000000", None),  # 未中獎
    ],
)
def test_match_prize_basic(number, expected):
    result = match_prize(number, DRAW_11507)
    if expected is None:
        assert result is None
    else:
        assert (result["name"], result["amount"]) == expected


def test_match_prize_fourth_digits():
    # 末 5 碼 48835 相同、末 6 碼不同 → 四獎
    assert (match_prize("AB99548835", DRAW_11507)["name"]) == "四獎"


def test_match_prize_extra_sixth():
    draw = {**DRAW_11507, "extra_sixth": ["338"]}
    result = match_prize("AB12345338", draw)
    assert (result["name"], result["amount"]) == ("增開六獎", 200)
    # 沒有增開六獎號時，同號碼不中獎
    assert match_prize("AB12345338", DRAW_11507) is None


def test_match_prize_takes_highest():
    draw = {
        "special": "12345678",
        "grand": "99999999",
        "first": ["99999678", "22222222", "33333333"],  # 末 3 碼也會中六獎
        "extra_sixth": [],
    }
    result = match_prize("AB12345678", draw)
    assert (result["name"], result["amount"]) == ("特別獎", 10000000)


def test_match_prize_with_model_instance():
    draw = LotteryDraw(
        period="11507",
        special=DRAW_11507["special"],
        grand=DRAW_11507["grand"],
        first=json.dumps(DRAW_11507["first"]),
        extra_sixth="[]",
    )
    result = match_prize("AB14348835", draw)
    assert (result["name"], result["amount"]) == ("二獎", 40000)


def test_match_prize_uses_only_own_period_first():
    # 只比 8 碼數字；字軌不同也算中
    assert match_prize("XY54348835", DRAW_11507)["name"] == "頭獎"


# ---------- ensure_fresh_draws / 自動對獎 ----------

def test_ensure_fresh_draws_returns_new_periods(app, rss):
    with app.app_context():
        assert ensure_fresh_draws(force=True) == ["11507", "11505", "11503", "11501", "11411", "11409"]
        # 資料還很新，不強制時不重抓
        assert ensure_fresh_draws() == []
        # 強制重抓，期別都已存在 → 沒有新期別
        assert ensure_fresh_draws(force=True) == []


def test_ensure_fresh_draws_fetch_failure_keeps_old(app, client, auth_headers, rss, monkeypatch):
    with app.app_context():
        ensure_fresh_draws(force=True)
    # 抓取失敗 → 沿用舊資料
    from app.services import lottery as lottery_service

    def boom():
        raise RuntimeError("網路斷了")

    monkeypatch.setattr(lottery_service, "fetch_rss", boom)
    with app.app_context():
        assert ensure_fresh_draws(force=True) == []
        assert LotteryDraw.query.count() == 6


def test_invoice_created_after_draw_wins_immediately(loaded_draws, client, auth_headers):
    inv_id = str(uuidlib.uuid4())
    resp = put_inv(client, auth_headers, inv_id=inv_id, number=WINNING_NUMBER)
    assert resp.status_code == 201
    inv = resp.get_json()["invoice"]
    assert inv["prizeStatus"] == "won"
    assert inv["prizeName"] == WINNING_PRIZE[0]
    assert inv["prizeAmount"] == WINNING_PRIZE[1]
    assert inv["checkedAt"] is not None

    notifications = client.get("/api/notifications", headers=auth_headers).get_json()
    assert notifications["unreadCount"] == 1
    note = notifications["notifications"][0]
    assert note["type"] == "lottery_win"
    assert note["title"] == f"恭喜中獎！115年 07-08月 {WINNING_PRIZE[0]}"
    assert note["invoiceId"] == inv_id
    assert "XY-12348835" in note["body"]
    assert "好食光便當" in note["body"]
    assert f"NT${WINNING_PRIZE[1]:,}" in note["body"]

    # 再 PUT 一次相同資料：號碼／日期沒變 → 不重設、不重複通知
    resp = put_inv(client, auth_headers, inv_id=inv_id, number=WINNING_NUMBER)
    assert resp.status_code == 200
    assert resp.get_json()["invoice"]["prizeStatus"] == "won"
    assert client.get("/api/notifications", headers=auth_headers).get_json()["unreadCount"] == 1


def test_invoice_before_draw_becomes_won_after_sync(rss, app, client, auth_headers):
    inv_id = str(uuidlib.uuid4())
    resp = put_inv(client, auth_headers, inv_id=inv_id, number=WINNING_NUMBER)
    assert resp.get_json()["invoice"]["prizeStatus"] == "pending"  # 還沒有獎號

    with app.app_context():
        ensure_fresh_draws(force=True)  # 抓到新獎號 → 自動對獎

    inv = client.get("/api/invoices", headers=auth_headers).get_json()["invoices"][0]
    assert inv["prizeStatus"] == "won"
    assert inv["prizeName"] == WINNING_PRIZE[0]
    assert client.get("/api/notifications", headers=auth_headers).get_json()["unreadCount"] == 1


def test_not_won_invoice_gets_no_notification(loaded_draws, client, auth_headers):
    put_inv(client, auth_headers, number="AB00000001")
    inv = client.get("/api/invoices", headers=auth_headers).get_json()["invoices"][0]
    assert inv["prizeStatus"] == "not_won"
    assert inv["prizeAmount"] == 0
    assert client.get("/api/notifications", headers=auth_headers).get_json()["unreadCount"] == 0


# ---------- API ----------

def test_draws_endpoint_shape(rss, app, client, auth_headers, monkeypatch):
    from app.api import lottery as lottery_api

    monkeypatch.setattr(lottery_api, "today_taipei", lambda: date(2026, 10, 23))
    resp = client.get("/api/lottery/draws", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.get_json()
    assert len(data["draws"]) == 6
    assert [d["period"] for d in data["draws"]] == [
        "11507", "11505", "11503", "11501", "11411", "11409",
    ]  # period 新到舊
    first = data["draws"][0]
    assert first["label"] == "115年 07-08月"
    assert first["special"] == "89996565"
    assert first["grand"] == "91098182"
    assert first["first"] == ["54348835", "44991397", "06595111"]
    assert first["extraSixth"] == []
    assert first["drawDate"] == "2026-09-25"
    assert first["fetchedAt"].endswith("Z")
    assert data["lastFetchedAt"].endswith("Z")
    assert data["nextDraw"] == {
        "period": "11509",
        "label": "115年 09-10月",
        "drawDate": "2026-11-25",
    }


def test_draws_endpoint_502_when_no_data(no_network, client, auth_headers):
    resp = client.get("/api/lottery/draws", headers=auth_headers)
    assert resp.status_code == 502
    assert resp.get_json()["error"] == "lottery_unavailable"


def test_draws_requires_token(client):
    assert client.get("/api/lottery/draws").status_code == 401


def test_check_endpoint(rss, client, auth_headers):
    put_inv(client, auth_headers, number=WINNING_NUMBER, date="2026-08-10")  # 會中獎
    put_inv(client, auth_headers, number="AB00000001", date="2026-08-11")  # 沒中
    put_inv(client, auth_headers, number="AB00000002", date="2026-10-05")  # 11509 還沒開獎

    resp = client.post("/api/lottery/check", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["checked"] == 3
    assert data["summary"] == {"won": 1, "notWon": 1, "pending": 1}
    assert len(data["newWins"]) == 1
    assert data["newWins"][0]["number"] == WINNING_NUMBER
    assert data["newWins"][0]["prizeStatus"] == "won"


def test_check_only_own_invoices(rss, client, auth_headers, other_headers):
    put_inv(client, auth_headers, number=WINNING_NUMBER, date="2026-08-10")
    put_inv(client, other_headers, number="AB00000009", date="2026-08-10")

    resp = client.post("/api/lottery/check", headers=other_headers)
    data = resp.get_json()
    assert data["checked"] == 1
    assert data["summary"]["notWon"] == 1
    assert data["newWins"] == []


def test_lottery_sync_cli(rss, app):
    result = app.test_cli_runner().invoke(args=["lottery-sync"])
    assert result.exit_code == 0
    assert "11507" in result.output
