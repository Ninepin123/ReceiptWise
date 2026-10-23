"""註冊、登入、/me、token 錯誤格式。"""
import re
from datetime import timedelta

from flask_jwt_extended import create_access_token

ISO_Z_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


def test_register_ok(client):
    resp = client.post(
        "/api/auth/register",
        json={"email": "  Amy@Example.COM ", "password": "password123", "displayName": "小明"},
    )
    assert resp.status_code == 201
    data = resp.get_json()
    assert set(data.keys()) == {"token", "user"}
    user = data["user"]
    assert user["email"] == "amy@example.com"  # 存小寫、去空白
    assert user["displayName"] == "小明"
    assert isinstance(user["id"], int)
    assert ISO_Z_RE.match(user["createdAt"])


def test_register_default_display_name(client):
    resp = client.post(
        "/api/auth/register", json={"email": "someone@example.com", "password": "password123"}
    )
    assert resp.status_code == 201
    assert resp.get_json()["user"]["displayName"] == "someone"


def test_register_invalid_email(client):
    resp = client.post(
        "/api/auth/register", json={"email": "not-an-email", "password": "password123"}
    )
    assert resp.status_code == 400
    body = resp.get_json()
    assert body["error"] == "validation_error"
    assert "email" in body["fields"]


def test_register_short_password(client):
    resp = client.post(
        "/api/auth/register", json={"email": "a@b.com", "password": "short"}
    )
    assert resp.status_code == 400
    body = resp.get_json()
    assert body["error"] == "validation_error"
    assert "password" in body["fields"]


def test_register_display_name_too_long(client):
    resp = client.post(
        "/api/auth/register",
        json={"email": "a@b.com", "password": "password123", "displayName": "x" * 51},
    )
    assert resp.status_code == 400
    assert "displayName" in resp.get_json()["fields"]


def test_register_duplicate_email(client, auth_headers):
    resp = client.post(
        "/api/auth/register",
        json={"email": "USER@example.com", "password": "password456"},
    )
    assert resp.status_code == 409
    assert resp.get_json()["error"] == "email_taken"


def test_login_ok(client):
    client.post(
        "/api/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    resp = client.post("/api/auth/login", json={"email": "A@B.COM", "password": "password123"})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["token"]
    assert data["user"]["email"] == "a@b.com"


def test_login_wrong_password(client):
    client.post(
        "/api/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    resp = client.post("/api/auth/login", json={"email": "a@b.com", "password": "wrongpass"})
    assert resp.status_code == 401
    assert resp.get_json()["error"] == "invalid_credentials"


def test_login_unknown_email(client):
    resp = client.post("/api/auth/login", json={"email": "nobody@b.com", "password": "password123"})
    assert resp.status_code == 401
    assert resp.get_json()["error"] == "invalid_credentials"


def test_me(auth_headers, client):
    resp = client.get("/api/auth/me", headers=auth_headers)
    assert resp.status_code == 200
    user = resp.get_json()["user"]
    assert user["email"] == "user@example.com"
    assert user["displayName"] == "user"


def test_me_without_token(client):
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401
    body = resp.get_json()
    assert body["error"] == "unauthorized"
    assert "message" in body


def test_me_with_garbage_token(client):
    resp = client.get("/api/auth/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert resp.status_code == 401
    assert resp.get_json()["error"] == "unauthorized"


def test_me_with_expired_token(app, client):
    with app.test_request_context():
        token = create_access_token(identity="1", expires_delta=timedelta(seconds=-10))
    resp = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401
    assert resp.get_json()["error"] == "unauthorized"


def test_me_with_token_of_deleted_user(app, client):
    with app.test_request_context():
        token = create_access_token(identity="999")
    resp = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401
    assert resp.get_json()["error"] == "unauthorized"
