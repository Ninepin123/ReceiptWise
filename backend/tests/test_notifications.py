"""通知列表、已讀、全部已讀、unreadCount、上限 50 筆、隔離。"""
import uuid as uuidlib

from app.extensions import db
from app.models import Notification, User


def create_win_and_miss(loaded_draws, client, auth_headers):
    """建立一張中獎（四獎）和一張未中獎的發票 → 一則通知。"""
    put_ids = []
    for number in ("XY12348835", "XY54348836"):  # 第一張四獎、第二張未中獎
        resp = client.put(
            f"/api/invoices/{uuidlib.uuid4()}",
            json={"number": number, "date": "2026-08-10", "amount": 100, "seller": "店家"},
            headers=auth_headers,
        )
        put_ids.append(resp.get_json()["invoice"]["number"])
    return put_ids


def test_list_and_unread_count(loaded_draws, client, auth_headers):
    create_win_and_miss(loaded_draws, client, auth_headers)
    resp = client.get("/api/notifications", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["unreadCount"] == 1
    assert len(data["notifications"]) == 1
    note = data["notifications"][0]
    assert set(note.keys()) == {"id", "type", "title", "body", "invoiceId", "read", "createdAt"}
    assert note["read"] is False
    assert note["createdAt"].endswith("Z")


def test_two_winners_two_notifications(loaded_draws, client, auth_headers):
    # 54348835 頭獎、14348835 二獎
    for number in ("XY54348835", "XY14348835"):
        client.put(
            f"/api/invoices/{uuidlib.uuid4()}",
            json={"number": number, "date": "2026-08-10", "amount": 100},
            headers=auth_headers,
        )
    data = client.get("/api/notifications", headers=auth_headers).get_json()
    assert data["unreadCount"] == 2
    titles = {n["title"] for n in data["notifications"]}
    assert titles == {"恭喜中獎！115年 07-08月 頭獎", "恭喜中獎！115年 07-08月 二獎"}


def test_mark_read_and_404(loaded_draws, client, auth_headers, other_headers):
    create_win_and_miss(loaded_draws, client, auth_headers)
    note_id = client.get("/api/notifications", headers=auth_headers).get_json()["notifications"][0]["id"]

    resp = client.post(f"/api/notifications/{note_id}/read", headers=auth_headers)
    assert resp.status_code == 204
    assert client.get("/api/notifications", headers=auth_headers).get_json()["unreadCount"] == 0

    # 不存在的 id → 404
    assert client.post("/api/notifications/99999/read", headers=auth_headers).status_code == 404


def test_mark_all_read(loaded_draws, client, auth_headers):
    create_win_and_miss(loaded_draws, client, auth_headers)
    resp = client.post("/api/notifications/read-all", headers=auth_headers)
    assert resp.status_code == 204
    data = client.get("/api/notifications", headers=auth_headers).get_json()
    assert data["unreadCount"] == 0
    assert all(n["read"] for n in data["notifications"])


def test_isolation(app, loaded_draws, client, auth_headers, other_headers):
    create_win_and_miss(loaded_draws, client, auth_headers)
    data = client.get("/api/notifications", headers=other_headers).get_json()
    assert data["notifications"] == []
    assert data["unreadCount"] == 0
    # B 不能把 A 的通知標已讀
    note_id = client.get("/api/notifications", headers=auth_headers).get_json()["notifications"][0]["id"]
    assert client.post(f"/api/notifications/{note_id}/read", headers=other_headers).status_code == 404


def test_limit_50(app, client, auth_headers):
    with app.app_context():
        user = User.query.filter_by(email="user@example.com").first()
        for i in range(55):
            db.session.add(
                Notification(user_id=user.id, type="lottery_win", title=f"通知 {i}", body="x")
            )
        db.session.commit()
    data = client.get("/api/notifications", headers=auth_headers).get_json()
    assert len(data["notifications"]) == 50
    assert data["unreadCount"] == 55  # 計數不受列表上限影響
    # 新到舊：第一筆是最後建立的
    assert data["notifications"][0]["title"] == "通知 54"
