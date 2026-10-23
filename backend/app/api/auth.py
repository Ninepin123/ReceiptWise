"""註冊、登入、目前使用者。"""
import re

from flask import Blueprint, jsonify, request
from flask_jwt_extended import create_access_token, jwt_required

from app.api import current_user
from app.errors import ApiError
from app.extensions import db
from app.models import User

bp = Blueprint("auth", __name__)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@bp.post("/auth/register")
def register():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email") or "").strip().lower()
    password = data.get("password")
    display_name = str(data.get("displayName") or "").strip()

    fields = {}
    if not EMAIL_RE.match(email):
        fields["email"] = "email 格式不正確"
    if not isinstance(password, str) or len(password) < 8:
        fields["password"] = "密碼至少需要 8 個字元"
    if len(display_name) > 50:
        fields["displayName"] = "顯示名稱最多 50 字"
    if fields:
        raise ApiError("validation_error", "註冊資料格式不正確", 400, fields)

    if not display_name:
        display_name = email.split("@")[0]

    if User.query.filter_by(email=email).first() is not None:
        raise ApiError("email_taken", "這個 email 已經註冊過了", 409)

    user = User(email=email, display_name=display_name)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()

    token = create_access_token(identity=str(user.id))
    return jsonify({"token": token, "user": user.to_dict()}), 201


@bp.post("/auth/login")
def login():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email") or "").strip().lower()
    password = data.get("password")

    user = User.query.filter_by(email=email).first()
    if user is None or not isinstance(password, str) or not user.check_password(password):
        raise ApiError("invalid_credentials", "email 或密碼不正確", 401)

    token = create_access_token(identity=str(user.id))
    return jsonify({"token": token, "user": user.to_dict()}), 200


@bp.get("/auth/me")
@jwt_required()
def me():
    return jsonify({"user": current_user().to_dict()}), 200
