"""示範資料：`flask --app wsgi seed-demo` 建立示範帳號與近半年的收支、發票。"""
import json
import uuid
from datetime import date

import click

from app.extensions import db
from app.models import Invoice, Transaction, User
from app.utils import date_to_period

DEMO_EMAIL = "demo@receiptwise.test"
DEMO_PASSWORD = "demo12345"

# (日期, 類型, 項目, 分類, 金額)
_TRANSACTIONS = [
    ("2026-05-05", "income", "五月薪資", "薪資", 42000),
    ("2026-05-08", "expense", "房租", "居家", 12000),
    ("2026-05-12", "expense", "超市採買", "購物", 2350),
    ("2026-05-20", "expense", "聚餐", "餐飲", 1880),
    ("2026-06-05", "income", "六月薪資", "薪資", 42000),
    ("2026-06-08", "expense", "房租", "居家", 12000),
    ("2026-06-15", "expense", "高鐵來回", "交通", 2980),
    ("2026-06-22", "expense", "電影", "娛樂", 640),
    ("2026-07-05", "income", "七月薪資", "薪資", 42000),
    ("2026-07-08", "expense", "房租", "居家", 12000),
    ("2026-07-10", "expense", "看牙醫", "醫療", 1500),
    ("2026-07-26", "expense", "線上課程", "教育", 3600),
    ("2026-08-05", "income", "八月薪資", "薪資", 42000),
    ("2026-08-08", "expense", "房租", "居家", 12000),
    ("2026-08-12", "expense", "暑假旅行住宿", "娛樂", 9800),
    ("2026-08-13", "expense", "旅行餐費", "餐飲", 4200),
    ("2026-08-20", "expense", "新耳機", "購物", 5490),
    ("2026-09-05", "income", "九月薪資", "薪資", 42000),
    ("2026-09-08", "expense", "房租", "居家", 12000),
    ("2026-09-18", "expense", "健身房月費", "其他", 1200),
    ("2026-09-27", "income", "專案獎金", "獎金", 8000),
    ("2026-10-05", "income", "十月薪資", "薪資", 42000),
    ("2026-10-08", "expense", "房租", "居家", 12000),
    ("2026-10-12", "expense", "串流訂閱", "娛樂", 390),
    ("2026-10-18", "expense", "捷運加值", "交通", 500),
]

# (日期, 發票號碼, 店家, 統編, 隨機碼, 金額, 分類)。KT40812111 末 3 碼對中 115年07-08月頭獎 06595111 → 六獎
_INVOICES = [
    ("2026-08-03", "KT40812111", "全家便利商店", "16446274", "3021", 89, "餐飲"),
    ("2026-08-16", "QR55102347", "家樂福", "22662550", "7710", 1260, "購物"),
    ("2026-10-19", "AB12345678", "好食光便當", "53212539", "1234", 120, "餐飲"),
    ("2026-10-21", "ZX90817264", "7-ELEVEN", "22555003", "5582", 75, "餐飲"),
]


@click.command("seed-demo")
@click.option("--reset", is_flag=True, help="先刪掉示範帳號的所有資料再重建")
def seed_demo(reset: bool):
    """建立示範帳號與近半年的收支、發票（對獎頁按「立即對獎」可看到中獎）。"""
    user = User.query.filter_by(email=DEMO_EMAIL).first()
    if user and not reset:
        click.echo(f"示範帳號已存在：{DEMO_EMAIL}（加 --reset 可重建資料）")
        return
    if user is None:
        user = User(email=DEMO_EMAIL, display_name="示範使用者")
        user.set_password(DEMO_PASSWORD)
        db.session.add(user)
        db.session.flush()
    else:
        Transaction.query.filter_by(user_id=user.id).delete()
        Invoice.query.filter_by(user_id=user.id).delete()

    for day, kind, title, category, amount in _TRANSACTIONS:
        db.session.add(
            Transaction(
                id=str(uuid.uuid4()), user_id=user.id, type=kind, title=title,
                category=category, amount=amount, date=date.fromisoformat(day), note="",
            )
        )

    for day, number, seller, seller_id, random_code, amount, category in _INVOICES:
        invoice_id = str(uuid.uuid4())
        invoice_date = date.fromisoformat(day)
        db.session.add(
            Invoice(
                id=invoice_id, user_id=user.id, number=number, date=invoice_date,
                period=date_to_period(invoice_date), amount=amount, seller=seller,
                seller_id=seller_id, random_code=random_code, items=json.dumps([]), source="qr",
            )
        )
        db.session.add(
            Transaction(
                id=str(uuid.uuid4()), user_id=user.id, type="expense", title=seller,
                category=category, amount=amount, date=invoice_date, note="", invoice_id=invoice_id,
            )
        )

    db.session.commit()
    click.echo(f"已建立示範資料：{DEMO_EMAIL} / {DEMO_PASSWORD}")
