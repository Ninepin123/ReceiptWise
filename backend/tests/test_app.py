"""health、錯誤格式、SPA 靜態檔。"""
import json


def test_health_no_auth(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.get_json() == {"status": "ok"}


def test_unknown_api_path_returns_json_404(client):
    resp = client.get("/api/no-such-endpoint")
    assert resp.status_code == 404
    body = resp.get_json()
    assert body["error"] == "not_found"
    assert "message" in body


def test_method_not_allowed_returns_json(client):
    resp = client.delete("/api/health")
    assert resp.status_code == 405
    body = resp.get_json()
    assert body["error"] == "method_not_allowed"


def test_spa_static_files(tmp_path):
    from app import create_app

    (tmp_path / "index.html").write_text("<html>ReceiptWise</html>", encoding="utf-8")
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "app.js").write_text("console.log(1)", encoding="utf-8")

    app = create_app(
        {
            "TESTING": True,
            "SECRET_KEY": "test",
            "JWT_SECRET_KEY": "test",
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "FRONTEND_DIST": str(tmp_path),
        }
    )
    client = app.test_client()

    # 根路徑回 index.html
    resp = client.get("/")
    assert resp.status_code == 200
    assert b"ReceiptWise" in resp.data

    # 靜態檔直接回傳
    assert client.get("/assets/app.js").status_code == 200

    # SPA fallback：不存在的路徑回 index.html
    assert b"ReceiptWise" in client.get("/invoices").data
    assert b"ReceiptWise" in client.get("/transactions/abc/edit").data

    # /api 找不到要回 JSON 404，不能回 index.html
    resp = client.get("/api/no-such-endpoint")
    assert resp.status_code == 404
    assert resp.get_json()["error"] == "not_found"


def test_error_response_shape_has_no_extra_keys(client):
    body = client.get("/api/transactions").get_json()
    assert set(body.keys()) == {"error", "message"}


def test_json_output_is_not_sorted(client, auth_headers):
    import uuid as uuidlib

    resp = client.put(
        f"/api/transactions/{uuidlib.uuid4()}",
        json={
            "type": "expense",
            "title": "t",
            "category": "c",
            "amount": 1,
            "date": "2026-10-19",
        },
        headers=auth_headers,
    )
    keys = list(json.loads(resp.data)["transaction"].keys())
    assert keys[0] == "id"  # to_dict 的順序不被 sort_keys 打亂
