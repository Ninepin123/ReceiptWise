"""應用程式設定：從環境變數讀取，沒設定就用開發用預設值。"""
import os
from datetime import timedelta

# backend/ 目錄（config.py 位於 backend/app/ 下）
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INSTANCE_DIR = os.path.join(BASE_DIR, "instance")


def _float_env(name: str, default: float) -> float:
    """讀取環境變數並轉 float，轉失敗就用預設值。"""
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY") or "receiptwise-dev-secret-key-change-me-in-production"
    JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY") or "receiptwise-dev-jwt-key-change-me-in-production"

    JWT_ACCESS_TOKEN_EXPIRES = timedelta(days=30)

    # multipart 請求上限 10MB（發票 OCR 圖片本身再限制 8MB，留點頭尾空間）
    MAX_CONTENT_LENGTH = 10 * 1024 * 1024

    SQLALCHEMY_DATABASE_URI = os.environ.get("DATABASE_URL") or (
        "sqlite:///" + os.path.join(INSTANCE_DIR, "receiptwise.db").replace("\\", "/")
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    LOTTERY_RSS_URL = os.environ.get(
        "LOTTERY_RSS_URL", "https://invoice.etax.nat.gov.tw/invoice.xml"
    )
    LOTTERY_REFRESH_HOURS = _float_env("LOTTERY_REFRESH_HOURS", 6.0)

    CORS_ORIGINS = [
        o.strip()
        for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")
        if o.strip()
    ]

    FRONTEND_DIST = os.environ.get("FRONTEND_DIST") or os.path.normpath(
        os.path.join(BASE_DIR, "..", "frontend", "dist")
    )
