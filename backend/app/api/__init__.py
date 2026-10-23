"""API blueprint 共用工具。"""
from flask_jwt_extended import get_jwt_identity

from app.errors import ApiError
from app.extensions import db
from app.models import User


def current_user() -> User:
    """從 JWT identity 取得目前使用者；token 有效但使用者不存在時回 401。"""
    identity = get_jwt_identity()
    try:
        user = db.session.get(User, int(identity))
    except (TypeError, ValueError):
        user = None
    if user is None:
        raise ApiError("unauthorized", "找不到使用者，請重新登入", 401)
    return user
