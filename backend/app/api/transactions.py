"""收支 CRUD（upsert + 離線友善語意）。"""
import calendar
import re
import uuid
from datetime import date

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.api import current_user
from app.errors import ApiError
from app.extensions import db
from app.models import Invoice, Transaction
from app.utils import parse_date, utcnow

bp = Blueprint("transactions", __name__)

MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def normalize_uuid(value) -> str | None:
    """驗證 UUID 字串，回過標準化後的值；不合法回 None。"""
    try:
        return str(uuid.UUID(value))
    except (ValueError, AttributeError, TypeError):
        return None


def _validate(data: dict, user) -> dict:
    """驗證並整理 payload，回傳欄位值；有錯就 raise 400（帶 fields）。"""
    fields = {}

    value_type = data.get("type")
    if value_type not in ("expense", "income"):
        fields["type"] = "類型必須是 expense 或 income"

    title = str(data.get("title") or "").strip()
    if not 1 <= len(title) <= 100:
        fields["title"] = "名稱長度必須在 1 到 100 字之間"

    category = str(data.get("category") or "").strip()
    if not 1 <= len(category) <= 20:
        fields["category"] = "分類長度必須在 1 到 20 字之間"

    amount = data.get("amount")
    if isinstance(amount, bool) or not isinstance(amount, int) or amount <= 0:
        fields["amount"] = "金額必須是大於 0 的整數"

    date_value = parse_date(data.get("date"))
    if date_value is None:
        fields["date"] = "日期格式必須是 YYYY-MM-DD"

    note = data.get("note")
    if note is None:
        note = ""
    if not isinstance(note, str) or len(note) > 255:
        fields["note"] = "備註最多 255 字"

    invoice_id = data.get("invoiceId")
    if invoice_id is not None:
        normalized = normalize_uuid(invoice_id)
        if normalized is None:
            fields["invoiceId"] = "invoiceId 必須是發票 UUID"
        elif Invoice.query.filter_by(id=normalized, user_id=user.id).first() is None:
            fields["invoiceId"] = "找不到這張發票"
        else:
            invoice_id = normalized

    if fields:
        raise ApiError("validation_error", "收支資料格式不正確", 400, fields)

    return {
        "type": value_type,
        "title": title,
        "category": category,
        "amount": amount,
        "date": date_value,
        "note": note,
        "invoice_id": invoice_id,
    }


@bp.get("/transactions")
@jwt_required()
def list_transactions():
    user = current_user()
    query = Transaction.query.filter_by(user_id=user.id)

    month = (request.args.get("month") or "").strip()
    if month:
        if not MONTH_RE.match(month):
            raise ApiError("validation_error", "month 格式必須是 YYYY-MM", 400, {"month": "month 格式必須是 YYYY-MM"})
        year, mon = int(month[:4]), int(month[5:])
        query = query.filter(
            Transaction.date >= date(year, mon, 1),
            Transaction.date <= date(year, mon, calendar.monthrange(year, mon)[1]),
        )

    rows = query.order_by(Transaction.date.desc(), Transaction.created_at.desc()).all()
    return jsonify({"transactions": [t.to_dict() for t in rows]})


@bp.put("/transactions/<id>")
@jwt_required()
def upsert_transaction(id: str):
    user = current_user()
    normalized_id = normalize_uuid(id)
    if normalized_id is None:
        raise ApiError("validation_error", "id 必須是 UUID", 400, {"id": "id 必須是 UUID 格式"})

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("validation_error", "請求內容必須是 JSON 物件", 400)
    values = _validate(data, user)

    existing = db.session.get(Transaction, normalized_id)
    if existing is not None and existing.user_id != user.id:
        raise ApiError("not_found", "找不到資源", 404)

    if existing is None:
        tx = Transaction(id=normalized_id, user_id=user.id, created_at=utcnow())
        status = 201
    else:
        tx = existing
        status = 200

    for key, value in values.items():
        setattr(tx, key, value)
    tx.updated_at = utcnow()
    db.session.add(tx)
    db.session.commit()
    return jsonify({"transaction": tx.to_dict()}), status


@bp.delete("/transactions/<id>")
@jwt_required()
def delete_transaction(id: str):
    user = current_user()
    normalized_id = normalize_uuid(id)
    if normalized_id is None:
        raise ApiError("validation_error", "id 必須是 UUID", 400, {"id": "id 必須是 UUID 格式"})

    tx = db.session.get(Transaction, normalized_id)
    if tx is not None and tx.user_id == user.id:
        db.session.delete(tx)
        db.session.commit()
    return "", 204
