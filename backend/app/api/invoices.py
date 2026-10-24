"""發票 CRUD：號碼正規化、期別由伺服器計算、必要時觸發對獎。"""
import json
import re

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import jwt_required

from app.api import current_user
from app.api.transactions import normalize_uuid
from app.errors import ApiError
from app.extensions import db
from app.models import Invoice, Transaction
from app.services.invoice_ocr import OcrUnavailable, recognize_invoice
from app.services.lottery import check_invoice
from app.utils import (
    date_to_period,
    is_valid_invoice_number,
    normalize_invoice_number,
    parse_date,
    utcnow,
)

bp = Blueprint("invoices", __name__)

PERIOD_RE = re.compile(r"^\d{5}$")
SELLER_ID_RE = re.compile(r"^\d{8}$")
RANDOM_CODE_RE = re.compile(r"^\d{4}$")
SOURCES = ("qr", "barcode", "manual", "ocr")
OCR_IMAGE_MIMETYPES = {"image/jpeg", "image/png", "image/webp"}
OCR_IMAGE_MAX_BYTES = 8 * 1024 * 1024


def _is_number(value) -> bool:
    """JSON 數字（int 或 float，但 bool 不算）。"""
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _validate(data: dict) -> dict:
    """驗證並整理 payload；對獎相關欄位一律由伺服器決定。"""
    fields = {}

    number = normalize_invoice_number(data.get("number"))
    if not is_valid_invoice_number(number):
        fields["number"] = "發票號碼格式不正確（兩個英文字母加 8 碼數字）"

    date_value = parse_date(data.get("date"))
    if date_value is None:
        fields["date"] = "日期格式必須是 YYYY-MM-DD"

    amount = data.get("amount")
    if amount is None:
        amount = 0
    if not _is_number(amount) or isinstance(amount, float) and not amount.is_integer() or int(amount) < 0:
        fields["amount"] = "金額必須是大於或等於 0 的整數"
    else:
        amount = int(amount)

    seller = data.get("seller")
    if seller is None:
        seller = ""
    if not isinstance(seller, str) or len(seller) > 100:
        fields["seller"] = "店家名稱最多 100 字"

    seller_id = str(data.get("sellerId") or "").strip()
    if seller_id and not SELLER_ID_RE.match(seller_id):
        fields["sellerId"] = "賣方統編必須是 8 碼數字"

    random_code = str(data.get("randomCode") or "").strip()
    if random_code and not RANDOM_CODE_RE.match(random_code):
        fields["randomCode"] = "隨機碼必須是 4 碼數字"

    source = data.get("source")
    if source is None:
        source = "manual"
    if source not in SOURCES:
        fields["source"] = "來源必須是 qr、barcode、manual 或 ocr"

    items = data.get("items")
    if items is None:
        items = []
    if not isinstance(items, list):
        fields["items"] = "品項必須是陣列"
        items = []
    else:
        cleaned = []
        for item in items:
            if not isinstance(item, dict):
                fields["items"] = "每個品項必須是物件"
                break
            qty = item.get("qty", 0)
            price = item.get("price", 0)
            if not _is_number(qty) or not _is_number(price):
                fields["items"] = "品項的數量和單價必須是數字"
                break
            cleaned.append(
                {"name": str(item.get("name") or ""), "qty": qty, "price": price}
            )
        items = cleaned

    if fields:
        raise ApiError("validation_error", "發票資料格式不正確", 400, fields)

    return {
        "number": number,
        "date": date_value,
        "period": date_to_period(date_value),
        "amount": amount,
        "seller": seller,
        "seller_id": seller_id,
        "random_code": random_code,
        "items": items,
        "source": source,
    }


@bp.get("/invoices")
@jwt_required()
def list_invoices():
    user = current_user()
    query = Invoice.query.filter_by(user_id=user.id)

    period = (request.args.get("period") or "").strip()
    if period:
        if not PERIOD_RE.match(period):
            raise ApiError("validation_error", "period 必須是 5 碼數字", 400, {"period": "period 必須是 5 碼數字"})
        query = query.filter_by(period=period)

    rows = query.order_by(Invoice.date.desc(), Invoice.created_at.desc()).all()
    return jsonify({"invoices": [inv.to_dict() for inv in rows]})


@bp.put("/invoices/<id>")
@jwt_required()
def upsert_invoice(id: str):
    user = current_user()
    normalized_id = normalize_uuid(id)
    if normalized_id is None:
        raise ApiError("validation_error", "id 必須是 UUID", 400, {"id": "id 必須是 UUID 格式"})

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("validation_error", "請求內容必須是 JSON 物件", 400)
    values = _validate(data)

    existing = db.session.get(Invoice, normalized_id)
    if existing is not None and existing.user_id != user.id:
        raise ApiError("not_found", "找不到資源", 404)

    # 同一使用者的另一筆發票已有相同號碼 → 409
    duplicate = Invoice.query.filter(
        Invoice.user_id == user.id,
        Invoice.number == values["number"],
        Invoice.id != normalized_id,
    ).first()
    if duplicate is not None:
        raise ApiError("duplicate_invoice", "這個發票號碼已經存在", 409)

    if existing is None:
        invoice = Invoice(id=normalized_id, user_id=user.id, created_at=utcnow())
        status = 201
    else:
        invoice = existing
        status = 200

    number_or_date_changed = (
        existing is None or invoice.number != values["number"] or invoice.date != values["date"]
    )

    for key, value in values.items():
        setattr(invoice, key, value)
    invoice.items = json.dumps(values["items"], ensure_ascii=False)

    if number_or_date_changed:
        # 重設對獎結果；該期獎號已存在就立刻對獎（中獎會順便建立通知）
        invoice.prize_status = "pending"
        invoice.prize_name = None
        invoice.prize_amount = 0
        invoice.checked_at = None
        check_invoice(invoice)

    invoice.updated_at = utcnow()
    db.session.add(invoice)
    db.session.commit()
    return jsonify({"invoice": invoice.to_dict()}), status


@bp.post("/invoices/ocr")
@jwt_required()
def ocr_invoice():
    """上傳發票照片做文字辨識（multipart 欄位 image），回傳辨識出的欄位供使用者核對。"""
    file = request.files.get("image")
    if file is None:
        raise ApiError("validation_error", "請上傳圖片", 400, {"image": "請上傳圖片"})
    if file.mimetype not in OCR_IMAGE_MIMETYPES:
        raise ApiError("validation_error", "圖片格式必須是 JPEG、PNG 或 WebP", 400, {"image": "圖片格式必須是 JPEG、PNG 或 WebP"})
    data = file.read()
    if len(data) > OCR_IMAGE_MAX_BYTES:
        raise ApiError("validation_error", "圖片太大（上限 8MB）", 413, {"image": "圖片太大（上限 8MB）"})

    try:
        result = recognize_invoice(data)
    except OcrUnavailable:
        raise ApiError("ocr_unavailable", "伺服器沒有安裝文字辨識套件", 503)
    except ValueError:
        raise ApiError("validation_error", "無法讀取圖片", 400, {"image": "無法讀取圖片"})

    # 只記錄花費時間，圖片內容不進 log
    current_app.logger.info("發票照片 OCR 花費 %d ms", result["elapsedMs"])
    return jsonify({"result": result})


@bp.delete("/invoices/<id>")
@jwt_required()
def delete_invoice(id: str):
    user = current_user()
    normalized_id = normalize_uuid(id)
    if normalized_id is None:
        raise ApiError("validation_error", "id 必須是 UUID", 400, {"id": "id 必須是 UUID 格式"})

    invoice = db.session.get(Invoice, normalized_id)
    if invoice is not None and invoice.user_id == user.id:
        # 連到這張發票的收支改成沒有發票
        Transaction.query.filter(
            Transaction.user_id == user.id, Transaction.invoice_id == normalized_id
        ).update({"invoice_id": None})
        db.session.delete(invoice)
        db.session.commit()
    return "", 204
