"""期別換算、開獎日、nextDraw、號碼正規化、日期與時間格式的單元測試。"""
from datetime import date, datetime, timezone

import pytest

from app.utils import (
    date_to_period,
    iso_z,
    next_draw,
    normalize_invoice_number,
    parse_date,
    period_draw_date,
    period_label,
    previous_period,
    today_taipei,
)


@pytest.mark.parametrize(
    "value,expected",
    [
        (date(2026, 8, 31), "11507"),
        (date(2026, 9, 1), "11509"),
        (date(2026, 10, 18), "11509"),
        (date(2026, 10, 31), "11509"),
        (date(2026, 11, 1), "11511"),
        (date(2026, 12, 31), "11511"),
        (date(2027, 1, 25), "11601"),  # 跨民國年
        (date(2025, 12, 31), "11411"),
    ],
)
def test_date_to_period(value, expected):
    assert date_to_period(value) == expected


@pytest.mark.parametrize(
    "period,expected",
    [
        ("11507", "115年 07-08月"),
        ("11501", "115年 01-02月"),
        ("11511", "115年 11-12月"),
    ],
)
def test_period_label(period, expected):
    assert period_label(period) == expected


@pytest.mark.parametrize(
    "period,expected",
    [
        ("11507", date(2026, 9, 25)),
        ("11509", date(2026, 11, 25)),
        ("11511", date(2027, 1, 25)),  # 跨西元年
        ("11411", date(2026, 1, 25)),
        ("11601", date(2027, 3, 25)),
    ],
)
def test_period_draw_date(period, expected):
    assert period_draw_date(period) == expected


@pytest.mark.parametrize(
    "period,expected", [("11503", "11501"), ("11501", "11411"), ("11411", "11409")]
)
def test_previous_period(period, expected):
    assert previous_period(period) == expected


@pytest.mark.parametrize(
    "today,period,draw_date",
    [
        (date(2026, 10, 23), "11509", date(2026, 11, 25)),  # 任務範例
        (date(2026, 9, 25), "11507", date(2026, 9, 25)),  # 開獎當天，還沒開獎
        (date(2026, 11, 25), "11509", date(2026, 11, 25)),  # 開獎當天
        (date(2026, 11, 26), "11511", date(2027, 1, 25)),  # 隔天換下一期
        (date(2026, 12, 31), "11511", date(2027, 1, 25)),
        (date(2027, 1, 26), "11601", date(2027, 3, 25)),  # 跨民國年
    ],
)
def test_next_draw(today, period, draw_date):
    result = next_draw(today)
    assert result["period"] == period
    assert result["drawDate"] == draw_date.isoformat()
    assert result["label"] == period_label(period)


def test_today_taipei():
    assert isinstance(today_taipei(), date)


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("ab-12345678", "AB12345678"),
        (" ab 1234-5678 ", "AB12345678"),
        ("AB12345678", "AB12345678"),
    ],
)
def test_normalize_invoice_number(raw, expected):
    assert normalize_invoice_number(raw) == expected


@pytest.mark.parametrize(
    "value,expected",
    [
        ("2026-10-18", date(2026, 10, 18)),
        ("2026-02-30", None),  # 日期不合法
        ("2026-13-01", None),
        ("20261018", None),  # 不接受 basic 格式
        (123, None),
        (None, None),
    ],
)
def test_parse_date(value, expected):
    assert parse_date(value) == expected


def test_iso_z():
    naive = datetime(2026, 10, 19, 4, 0, 0)
    assert iso_z(naive) == "2026-10-19T04:00:00Z"
    aware = datetime(2026, 10, 19, 12, 0, 0, tzinfo=timezone.utc)
    assert iso_z(aware) == "2026-10-19T12:00:00Z"
    assert iso_z(None) is None
