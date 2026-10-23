"""pytest 共用 fixture。測試絕對不連網路。"""
import os

import pytest

from app import create_app

FIXTURES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


@pytest.fixture()
def app(tmp_path):
    app = create_app(
        {
            "TESTING": True,
            "SECRET_KEY": "test",
            "JWT_SECRET_KEY": "test-secret-key-for-pytest-only-0123456789",
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "FRONTEND_DIST": str(tmp_path / "no-such-dist"),
        }
    )
    return app


@pytest.fixture()
def client(app):
    return app.test_client()


def register_user(client, email="user@example.com", password="password123", display_name=None):
    payload = {"email": email, "password": password}
    if display_name is not None:
        payload["displayName"] = display_name
    resp = client.post("/api/auth/register", json=payload)
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()["token"]


@pytest.fixture()
def auth_headers(client):
    """使用者 A。"""
    token = register_user(client)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def other_headers(client):
    """使用者 B（測資料隔離）。"""
    token = register_user(client, email="other@example.com")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """預設把 fetch_rss 換成會拋錯的版本，避免任何測試真的連網路。"""
    from app.services import lottery as lottery_service

    def boom():
        raise RuntimeError("測試不應該連網路")

    monkeypatch.setattr(lottery_service, "fetch_rss", boom)


@pytest.fixture()
def rss(no_network, monkeypatch):
    """把 fetch_rss 換成回傳 tests/fixtures/invoice.xml 的內容。"""
    from app.services import lottery as lottery_service

    with open(os.path.join(FIXTURES_DIR, "invoice.xml"), encoding="utf-8") as f:
        content = f.read()
    monkeypatch.setattr(lottery_service, "fetch_rss", lambda: content)
    return content


@pytest.fixture()
def loaded_draws(app, rss):
    """把 fixture 的 6 期獎號先塞進資料庫。"""
    from app.services.lottery import ensure_fresh_draws

    with app.app_context():
        ensure_fresh_draws(force=True)
