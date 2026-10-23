"""對獎 API：獎號查詢、立即對獎。"""
from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required

from app.api import current_user
from app.errors import ApiError
from app.extensions import db
from app.models import Invoice, LotteryDraw
from app.services.lottery import check_invoice, ensure_fresh_draws
from app.utils import iso_z, next_draw, today_taipei

bp = Blueprint("lottery", __name__)


@bp.get("/lottery/draws")
@jwt_required()
def draws():
    ensure_fresh_draws()
    rows = LotteryDraw.query.order_by(LotteryDraw.period.desc()).all()
    if not rows:
        # 完全沒有獎號而且抓不到 RSS
        raise ApiError("lottery_unavailable", "目前無法取得統一發票獎號，請稍後再試", 502)
    last_fetched = max(d.fetched_at for d in rows)
    return jsonify(
        {
            "draws": [d.to_dict() for d in rows],
            "lastFetchedAt": iso_z(last_fetched),
            "nextDraw": next_draw(today_taipei()),
        }
    )


@bp.post("/lottery/check")
@jwt_required()
def check():
    user = current_user()
    invoices = Invoice.query.filter_by(user_id=user.id).all()
    # 先記下原本狀態：ensure_fresh_draws 抓到新期別時就會順便對獎
    before = {invoice.id: invoice.prize_status for invoice in invoices}

    ensure_fresh_draws()
    invoices = Invoice.query.filter_by(user_id=user.id).all()
    for invoice in invoices:
        check_invoice(invoice)
    db.session.commit()

    new_wins = [
        invoice
        for invoice in invoices
        if invoice.prize_status == "won" and before.get(invoice.id, "pending") != "won"
    ]

    summary = {"won": 0, "notWon": 0, "pending": 0}
    for invoice in invoices:
        if invoice.prize_status == "won":
            summary["won"] += 1
        elif invoice.prize_status == "not_won":
            summary["notWon"] += 1
        else:
            summary["pending"] += 1

    return jsonify(
        {
            "checked": len(invoices),
            "newWins": [invoice.to_dict() for invoice in new_wins],
            "summary": summary,
        }
    )
