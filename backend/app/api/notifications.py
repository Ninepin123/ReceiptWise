"""站內通知（中獎鈴鐺）。"""
from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required

from app.api import current_user
from app.errors import ApiError
from app.extensions import db
from app.models import Notification

bp = Blueprint("notifications", __name__)


@bp.get("/notifications")
@jwt_required()
def list_notifications():
    user = current_user()
    rows = (
        Notification.query.filter_by(user_id=user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(50)
        .all()
    )
    unread = Notification.query.filter_by(user_id=user.id, read=False).count()
    return jsonify({"notifications": [n.to_dict() for n in rows], "unreadCount": unread})


@bp.post("/notifications/<int:notification_id>/read")
@jwt_required()
def mark_read(notification_id: int):
    user = current_user()
    notification = db.session.get(Notification, notification_id)
    if notification is None or notification.user_id != user.id:
        raise ApiError("not_found", "找不到資源", 404)
    notification.read = True
    db.session.commit()
    return "", 204


@bp.post("/notifications/read-all")
@jwt_required()
def mark_all_read():
    user = current_user()
    Notification.query.filter_by(user_id=user.id, read=False).update({"read": True})
    db.session.commit()
    return "", 204
