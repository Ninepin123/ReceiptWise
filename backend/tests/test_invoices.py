"""發票 upsert、號碼正規化、period 計算、重複號碼、刪除行為、隔離。"""
import uuid as uuidlib

BASE = {
    "number": "AB12345678",
    "date": "2026-10-18",
    "amount": 120,
    "seller": "好食光便當",
    "sellerId": "12345678",
    "randomCode": "1234",
    "items": [{"name": "便當", "qty": 1, "price": 120}],
    "source": "qr",
}


def put_inv(client, headers, inv_id=None, **overrides):
    payload = {**BASE, **overrides}
    return client.put(f"/api/invoices/{inv_id or uuidlib.uuid4()}", json=payload, headers=headers)


def test_create_normalizes_number_and_computes_period(client, auth_headers):
    resp = put_inv(client, auth_headers, number="ab-1234 5678")
    assert resp.status_code == 201
    inv = resp.get_json()["invoice"]
    assert inv["number"] == "AB12345678"
    assert inv["period"] == "11509"
    assert inv["sellerId"] == "12345678"
    assert inv["randomCode"] == "1234"
    assert inv["items"] == [{"name": "便當", "qty": 1, "price": 120}]
    assert inv["prizeStatus"] == "pending"  # 沒有獎號時不對獎
    assert inv["prizeName"] is None
    assert inv["prizeAmount"] == 0
    assert inv["checkedAt"] is None


def test_period_boundaries(client, auth_headers):
    cases = [
        ("2025-12-31", "11411"),
        ("2026-01-01", "11501"),
        ("2026-02-28", "11501"),
        ("2026-08-31", "11507"),
        ("2026-09-01", "11509"),
        ("2026-10-31", "11509"),
        ("2026-11-01", "11511"),
        ("2026-12-31", "11511"),
        ("2027-01-01", "11601"),
    ]
    for index, (date_value, period) in enumerate(cases):
        resp = put_inv(client, auth_headers, date=date_value, number=f"CD{index:08d}")
        assert resp.status_code == 201, date_value
        assert resp.get_json()["invoice"]["period"] == period, date_value


def test_invalid_numbers(client, auth_headers):
    for number in ["A12345678", "AB1234567", "AB123456789", "12A345678", "", "AB-1234567"]:
        resp = put_inv(client, auth_headers, number=number)
        assert resp.status_code == 400, number
        body = resp.get_json()
        assert body["error"] == "validation_error"
        assert "number" in body["fields"]


def test_duplicate_number_same_user_409(client, auth_headers):
    assert put_inv(client, auth_headers).status_code == 201
    resp = put_inv(client, auth_headers)  # 不同 id、相同號碼
    assert resp.status_code == 409
    assert resp.get_json()["error"] == "duplicate_invoice"


def test_same_number_different_users_ok(client, auth_headers, other_headers):
    assert put_inv(client, auth_headers).status_code == 201
    assert put_inv(client, other_headers).status_code == 201


def test_field_validations(client, auth_headers):
    cases = [
        ({"date": "2026-13-01"}, "date"),
        ({"amount": -1}, "amount"),
        ({"amount": "120"}, "amount"),
        ({"seller": "x" * 101}, "seller"),
        ({"sellerId": "1234567"}, "sellerId"),
        ({"randomCode": "12ab"}, "randomCode"),
        ({"source": "magic"}, "source"),
        ({"items": "not-a-list"}, "items"),
        ({"items": [{"name": "x", "qty": "1", "price": 10}]}, "items"),
    ]
    for overrides, field in cases:
        resp = put_inv(client, auth_headers, **overrides)
        assert resp.status_code == 400, overrides
        assert field in resp.get_json()["fields"], overrides


def test_amount_zero_ok(client, auth_headers):
    resp = put_inv(client, auth_headers, amount=0, number="ZZ11111111")
    assert resp.status_code == 201
    assert resp.get_json()["invoice"]["amount"] == 0


def test_prize_fields_from_input_ignored(client, auth_headers):
    resp = put_inv(
        client, auth_headers,
        prizeStatus="won", prizeName="頭獎", prizeAmount=200000, checkedAt="2026-01-01T00:00:00Z",
        period="11001",
    )
    assert resp.status_code == 201
    inv = resp.get_json()["invoice"]
    assert inv["prizeStatus"] == "pending"
    assert inv["prizeName"] is None
    assert inv["prizeAmount"] == 0
    assert inv["checkedAt"] is None
    assert inv["period"] == "11509"  # 伺服器計算


def test_period_filter(client, auth_headers):
    put_inv(client, auth_headers, number="AB11111111", date="2026-10-18")
    put_inv(client, auth_headers, number="AB22222222", date="2026-08-10")
    rows = client.get("/api/invoices?period=11507", headers=auth_headers).get_json()["invoices"]
    assert [r["number"] for r in rows] == ["AB22222222"]
    assert client.get("/api/invoices?period=abc", headers=auth_headers).status_code == 400


def test_list_order_and_delete(client, auth_headers):
    older = str(uuidlib.uuid4())
    put_inv(client, auth_headers, inv_id=older, number="AB33333333", date="2026-08-01")
    put_inv(client, auth_headers, number="AB44444444", date="2026-10-01")
    rows = client.get("/api/invoices", headers=auth_headers).get_json()["invoices"]
    assert [r["date"] for r in rows] == ["2026-10-01", "2026-08-01"]

    assert client.delete(f"/api/invoices/{older}", headers=auth_headers).status_code == 204
    rows = client.get("/api/invoices", headers=auth_headers).get_json()["invoices"]
    assert [r["number"] for r in rows] == ["AB44444444"]
    # 不存在也 204
    assert client.delete(f"/api/invoices/{uuidlib.uuid4()}", headers=auth_headers).status_code == 204


def test_isolation_between_users(client, auth_headers, other_headers):
    inv_id = str(uuidlib.uuid4())
    assert put_inv(client, auth_headers, inv_id=inv_id).status_code == 201

    assert client.get("/api/invoices", headers=other_headers).get_json()["invoices"] == []
    resp = client.put(
        f"/api/invoices/{inv_id}",
        json={**BASE, "amount": 999},
        headers=other_headers,
    )
    assert resp.status_code == 404
    assert client.delete(f"/api/invoices/{inv_id}", headers=other_headers).status_code == 204
    assert len(client.get("/api/invoices", headers=auth_headers).get_json()["invoices"]) == 1


def test_change_number_resets_prize(loaded_draws, client, auth_headers):
    inv_id = str(uuidlib.uuid4())
    resp = put_inv(client, auth_headers, inv_id=inv_id, number="XY12348835", date="2026-08-10")
    assert resp.get_json()["invoice"]["prizeStatus"] == "won"

    # 改成沒中獎的號碼 → 重設後重新對獎
    resp = put_inv(client, auth_headers, inv_id=inv_id, number="XY12348836", date="2026-08-10")
    inv = resp.get_json()["invoice"]
    assert inv["prizeStatus"] == "not_won"
    assert inv["prizeAmount"] == 0

    # 改號碼改回中獎號碼 → 又中獎（但不重複通知）
    resp = put_inv(client, auth_headers, inv_id=inv_id, number="XY12348835", date="2026-08-10")
    assert resp.get_json()["invoice"]["prizeStatus"] == "won"
    notifications = client.get("/api/notifications", headers=auth_headers).get_json()
    assert notifications["unreadCount"] == 1  # 同一期不重複通知
