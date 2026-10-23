"""收支 upsert、驗證、month 篩選、資料隔離。"""
import uuid as uuidlib

BASE = {
    "type": "expense",
    "title": "午餐便當",
    "category": "餐飲",
    "amount": 120,
    "date": "2026-10-19",
    "note": "",
}


def put_tx(client, headers, tx_id=None, **overrides):
    payload = {**BASE, **overrides}
    return client.put(f"/api/transactions/{tx_id or uuidlib.uuid4()}", json=payload, headers=headers)


def test_upsert_create_201(client, auth_headers):
    tx_id = str(uuidlib.uuid4())
    resp = put_tx(client, auth_headers, tx_id)
    assert resp.status_code == 201
    tx = resp.get_json()["transaction"]
    assert tx["id"] == tx_id
    assert tx["type"] == "expense"
    assert tx["title"] == "午餐便當"
    assert tx["category"] == "餐飲"
    assert tx["amount"] == 120
    assert tx["date"] == "2026-10-19"
    assert tx["note"] == ""
    assert tx["invoiceId"] is None
    assert tx["createdAt"].endswith("Z")
    assert tx["updatedAt"].endswith("Z")


def test_upsert_ignores_client_timestamps(client, auth_headers):
    tx_id = str(uuidlib.uuid4())
    resp = client.put(
        f"/api/transactions/{tx_id}",
        json={**BASE, "createdAt": "1999-01-01T00:00:00Z", "updatedAt": "1999-01-01T00:00:00Z"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    tx = resp.get_json()["transaction"]
    assert tx["createdAt"].startswith("20")
    assert tx["createdAt"] != "1999-01-01T00:00:00Z"


def test_upsert_update_200(client, auth_headers):
    tx_id = str(uuidlib.uuid4())
    assert put_tx(client, auth_headers, tx_id).status_code == 201
    resp = put_tx(client, auth_headers, tx_id, amount=150, title="晚餐")
    assert resp.status_code == 200
    tx = resp.get_json()["transaction"]
    assert tx["amount"] == 150
    assert tx["title"] == "晚餐"


def test_upsert_non_uuid_id_400(client, auth_headers):
    resp = client.put("/api/transactions/not-a-uuid", json=BASE, headers=auth_headers)
    assert resp.status_code == 400
    body = resp.get_json()
    assert body["error"] == "validation_error"
    assert "id" in body["fields"]


def test_validation_errors(client, auth_headers):
    cases = [
        ({"type": "donation"}, "type"),
        ({"title": ""}, "title"),
        ({"title": "x" * 101}, "title"),
        ({"category": ""}, "category"),
        ({"category": "x" * 21}, "category"),
        ({"amount": 0}, "amount"),
        ({"amount": -5}, "amount"),
        ({"amount": "120"}, "amount"),
        ({"amount": 12.5}, "amount"),
        ({"date": "2026-02-30"}, "date"),
        ({"date": "20261019"}, "date"),
        ({"note": "x" * 256}, "note"),
        ({"invoiceId": "garbage"}, "invoiceId"),
        ({"invoiceId": str(uuidlib.uuid4())}, "invoiceId"),  # 發票不存在
    ]
    for overrides, field in cases:
        resp = put_tx(client, auth_headers, **overrides)
        assert resp.status_code == 400, (overrides, resp.get_json())
        body = resp.get_json()
        assert body["error"] == "validation_error", overrides
        assert field in body["fields"], (overrides, body["fields"])


def test_income_type_and_note_ok(client, auth_headers):
    resp = put_tx(client, auth_headers, type="income", category="薪水", note="10 月薪資")
    assert resp.status_code == 201
    tx = resp.get_json()["transaction"]
    assert tx["type"] == "income"


def test_list_ordering_and_month_filter(client, auth_headers):
    first = str(uuidlib.uuid4())
    put_tx(client, auth_headers, first, date="2026-10-19")
    put_tx(client, auth_headers, date="2026-10-20", title="隔天")
    put_tx(client, auth_headers, date="2026-10-19", title="比較晚建立")
    put_tx(client, auth_headers, date="2026-09-01", title="上個月")

    resp = client.get("/api/transactions", headers=auth_headers)
    assert resp.status_code == 200
    rows = resp.get_json()["transactions"]
    assert len(rows) == 4
    # 依 date 新到舊、再依 createdAt 新到舊
    assert [r["title"] for r in rows] == ["隔天", "比較晚建立", "午餐便當", "上個月"]

    resp = client.get("/api/transactions?month=2026-10", headers=auth_headers)
    assert [r["date"] for r in resp.get_json()["transactions"]] == [
        "2026-10-20",
        "2026-10-19",
        "2026-10-19",
    ]

    resp = client.get("/api/transactions?month=2026-09", headers=auth_headers)
    assert [r["title"] for r in resp.get_json()["transactions"]] == ["上個月"]


def test_month_filter_invalid(client, auth_headers):
    resp = client.get("/api/transactions?month=2026-13", headers=auth_headers)
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "validation_error"


def test_delete_existing_and_missing(client, auth_headers):
    tx_id = str(uuidlib.uuid4())
    put_tx(client, auth_headers, tx_id)
    assert client.delete(f"/api/transactions/{tx_id}", headers=auth_headers).status_code == 204
    assert client.get("/api/transactions", headers=auth_headers).get_json()["transactions"] == []
    # 不存在也回 204
    assert (
        client.delete(f"/api/transactions/{uuidlib.uuid4()}", headers=auth_headers).status_code
        == 204
    )
    # 非 UUID 回 400
    assert client.delete("/api/transactions/xyz", headers=auth_headers).status_code == 400


def test_transactions_require_token(client):
    assert client.get("/api/transactions").status_code == 401
    assert client.get("/api/transactions").get_json()["error"] == "unauthorized"


def test_isolation_between_users(client, auth_headers, other_headers):
    tx_id = str(uuidlib.uuid4())
    assert put_tx(client, auth_headers, tx_id).status_code == 201

    # B 看不到 A 的資料
    resp = client.get("/api/transactions", headers=other_headers)
    assert resp.get_json()["transactions"] == []

    # B 改不到（當作不存在）
    resp = client.put(
        f"/api/transactions/{tx_id}", json={**BASE, "amount": 999}, headers=other_headers
    )
    assert resp.status_code == 404
    assert resp.get_json()["error"] == "not_found"

    # B 刪不掉（204 但 A 資料還在）
    assert client.delete(f"/api/transactions/{tx_id}", headers=other_headers).status_code == 204
    rows = client.get("/api/transactions", headers=auth_headers).get_json()["transactions"]
    assert len(rows) == 1 and rows[0]["amount"] == 120


def test_invoice_link_and_unlink(app, client, auth_headers):
    invoice_id = str(uuidlib.uuid4())
    resp = client.put(
        f"/api/invoices/{invoice_id}",
        json={"number": "AB12345678", "date": "2026-10-18", "amount": 120},
        headers=auth_headers,
    )
    assert resp.status_code == 201

    resp = put_tx(client, auth_headers, invoiceId=invoice_id)
    assert resp.status_code == 201
    assert resp.get_json()["transaction"]["invoiceId"] == invoice_id

    # 刪發票後 transaction.invoiceId 變 null
    assert client.delete(f"/api/invoices/{invoice_id}", headers=auth_headers).status_code == 204
    rows = client.get("/api/transactions", headers=auth_headers).get_json()["transactions"]
    assert rows[0]["invoiceId"] is None
