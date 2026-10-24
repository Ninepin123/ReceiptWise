"""資料庫模型。金額一律整數新台幣；日期輸出 YYYY-MM-DD；時間戳記存 UTC。"""
import json

from werkzeug.security import check_password_hash, generate_password_hash

from app.extensions import db
from app.utils import iso_z, period_label, period_draw_date, utcnow


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    display_name = db.Column(db.String(50), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)

    def set_password(self, password: str):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "email": self.email,
            "displayName": self.display_name,
            "createdAt": iso_z(self.created_at),
        }


class Transaction(db.Model):
    __tablename__ = "transactions"

    id = db.Column(db.String(36), primary_key=True)  # 前端產生的 UUID
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    type = db.Column(db.String(10), nullable=False)  # expense / income
    title = db.Column(db.String(100), nullable=False)
    category = db.Column(db.String(20), nullable=False)
    amount = db.Column(db.Integer, nullable=False)
    date = db.Column(db.Date, nullable=False)
    note = db.Column(db.String(255), nullable=False, default="")
    invoice_id = db.Column(db.String(36), db.ForeignKey("invoices.id"), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=utcnow, onupdate=utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "type": self.type,
            "title": self.title,
            "category": self.category,
            "amount": self.amount,
            "date": self.date.isoformat(),
            "note": self.note,
            "invoiceId": self.invoice_id,
            "createdAt": iso_z(self.created_at),
            "updatedAt": iso_z(self.updated_at),
        }


class Invoice(db.Model):
    __tablename__ = "invoices"
    __table_args__ = (db.UniqueConstraint("user_id", "number", name="uq_user_invoice_number"),)

    id = db.Column(db.String(36), primary_key=True)  # 前端產生的 UUID
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    number = db.Column(db.String(10), nullable=False)  # ^[A-Z]{2}\d{8}$
    date = db.Column(db.Date, nullable=False)
    period = db.Column(db.String(5), nullable=False, index=True)  # 伺服器依 date 算出
    amount = db.Column(db.Integer, nullable=False, default=0)
    seller = db.Column(db.String(100), nullable=False, default="")
    seller_id = db.Column(db.String(8), nullable=False, default="")
    random_code = db.Column(db.String(4), nullable=False, default="")
    items = db.Column(db.Text, nullable=False, default="[]")  # JSON 字串
    source = db.Column(db.String(10), nullable=False, default="manual")  # qr / barcode / manual / ocr
    prize_status = db.Column(db.String(10), nullable=False, default="pending")
    prize_name = db.Column(db.String(20), nullable=True)
    prize_amount = db.Column(db.Integer, nullable=False, default=0)
    checked_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=utcnow, onupdate=utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "number": self.number,
            "date": self.date.isoformat(),
            "period": self.period,
            "amount": self.amount,
            "seller": self.seller,
            "sellerId": self.seller_id,
            "randomCode": self.random_code,
            "items": json.loads(self.items or "[]"),
            "source": self.source,
            "prizeStatus": self.prize_status,
            "prizeName": self.prize_name,
            "prizeAmount": self.prize_amount,
            "checkedAt": iso_z(self.checked_at),
            "createdAt": iso_z(self.created_at),
            "updatedAt": iso_z(self.updated_at),
        }


class LotteryDraw(db.Model):
    __tablename__ = "lottery_draws"

    period = db.Column(db.String(5), primary_key=True)  # 例如 11507
    special = db.Column(db.String(8), nullable=False)  # 特別獎
    grand = db.Column(db.String(8), nullable=False)  # 特獎
    first = db.Column(db.Text, nullable=False)  # 頭獎，JSON 字串（3 組 8 碼）
    extra_sixth = db.Column(db.Text, nullable=False, default="[]")  # 增開六獎，JSON 字串
    published_at = db.Column(db.DateTime, nullable=True)  # RSS 的 pubDate
    fetched_at = db.Column(db.DateTime, nullable=False, default=utcnow)

    def to_dict(self) -> dict:
        return {
            "period": self.period,
            "label": period_label(self.period),
            "special": self.special,
            "grand": self.grand,
            "first": json.loads(self.first or "[]"),
            "extraSixth": json.loads(self.extra_sixth or "[]"),
            "drawDate": period_draw_date(self.period).isoformat(),
            "fetchedAt": iso_z(self.fetched_at),
        }


class Notification(db.Model):
    __tablename__ = "notifications"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    type = db.Column(db.String(30), nullable=False, default="lottery_win")
    title = db.Column(db.String(200), nullable=False)
    body = db.Column(db.Text, nullable=False)
    invoice_id = db.Column(db.String(36), nullable=True)
    read = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "type": self.type,
            "title": self.title,
            "body": self.body,
            "invoiceId": self.invoice_id,
            "read": self.read,
            "createdAt": iso_z(self.created_at),
        }
