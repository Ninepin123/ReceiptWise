"""統一發票對獎服務：抓財政部 RSS、對獎規則、產生中獎通知。"""
import html
import json
import re
import ssl
import xml.etree.ElementTree as ET
from datetime import timedelta, timezone
from email.utils import parsedate_to_datetime

import requests
from requests.adapters import HTTPAdapter
from flask import current_app
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.models import Invoice, LotteryDraw, Notification
from app.utils import period_label, utcnow

# 各獎別比對的末幾碼與獎金
_SUFFIX_PRIZES = [
    (7, "二獎", 40000),
    (6, "三獎", 10000),
    (5, "四獎", 4000),
    (4, "五獎", 1000),
    (3, "六獎", 200),
]

TITLE_RE = re.compile(r"(\d{2,3})\s*年\s*(\d{1,2})\s*[~～\-–—]\s*(\d{1,2})\s*月")
# 把 description 依「特別獎/特獎/頭獎/增開六獎」標籤切開（容忍全形/半形冒號）
LABEL_SPLIT_RE = re.compile(r"(特別獎|特獎|頭獎|增開六獎)\s*[：:]\s*")


class _NonStrictX509Adapter(HTTPAdapter):
    """Python 3.13 預設開啟 VERIFY_X509_STRICT，財政部網站憑證缺 Subject Key Identifier 會被拒絕。
    這裡仍然完整驗證憑證鏈與主機名稱，只關掉嚴格模式。"""

    def init_poolmanager(self, *args, **kwargs):
        context = ssl.create_default_context()
        context.verify_flags &= ~getattr(ssl, "VERIFY_X509_STRICT", 0)
        kwargs["ssl_context"] = context
        return super().init_poolmanager(*args, **kwargs)


def fetch_rss() -> str:
    """抓財政部統一發票中獎號碼 RSS，回傳 XML 文字；失敗會拋例外。"""
    url = current_app.config["LOTTERY_RSS_URL"]
    with requests.Session() as session:
        session.mount("https://", _NonStrictX509Adapter())
        resp = session.get(
            url,
            timeout=10,
            headers={"User-Agent": "Mozilla/5.0 (compatible; ReceiptWise/1.0)"},
        )
    resp.raise_for_status()
    return resp.text


def _pick_numbers(numbers: list[str], length: int) -> list[str]:
    """只保留指定長度的數字字串（保留前導 0）。"""
    return [n for n in numbers if len(n) == length]


def _parse_pubdate(value: str | None):
    if not value:
        return None
    try:
        dt = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def parse_rss(xml_text: str) -> list[dict]:
    """解析 RSS，回傳每期獎號（依 RSS 順序）。

    每筆：{period, special, grand, first: [...], extra_sixth: [...], published_at}
    """
    root = ET.fromstring(xml_text)
    draws = []
    for item in root.iter("item"):
        match = TITLE_RE.search(item.findtext("title") or "")
        if match is None:
            continue
        roc, first_month = int(match.group(1)), int(match.group(2))
        period = f"{roc:03d}{first_month:02d}"

        # description 是 HTML，去標籤後再依標籤切開抽數字
        text = html.unescape(re.sub(r"<[^>]+>", "\n", item.findtext("description") or ""))
        numbers: dict[str, list[str]] = {}
        parts = LABEL_SPLIT_RE.split(text)
        for i in range(1, len(parts) - 1, 2):
            numbers[parts[i]] = re.findall(r"\d+", parts[i + 1])

        special = _pick_numbers(numbers.get("特別獎", []), 8)
        grand = _pick_numbers(numbers.get("特獎", []), 8)
        first = _pick_numbers(numbers.get("頭獎", []), 8)
        extra_sixth = _pick_numbers(numbers.get("增開六獎", []), 3)
        if not special or not grand or not first:
            continue  # 資料不完整就略過這期

        draws.append(
            {
                "period": period,
                "special": special[0],
                "grand": grand[0],
                "first": first,
                "extra_sixth": extra_sixth,
                "published_at": _parse_pubdate(item.findtext("pubDate")),
            }
        )
    return draws


def _draw_value(draw, key: str):
    """draw 可以是 LotteryDraw 或 dict，欄位名用 snake_case。"""
    if isinstance(draw, dict):
        return draw.get(key)
    return getattr(draw, key, None)


def match_prize(number: str, draw) -> dict | None:
    """比對 8 碼數字（英文字軌不比），回傳 {"name", "amount"} 或 None；一張發票取最高獎。"""
    digits = str(number)[-8:]
    special = str(_draw_value(draw, "special") or "")
    grand = str(_draw_value(draw, "grand") or "")
    first_raw = _draw_value(draw, "first") or []
    first = [str(n) for n in json.loads(first_raw) if isinstance(first_raw, str)] if isinstance(first_raw, str) else [str(n) for n in first_raw]
    extra_raw = _draw_value(draw, "extra_sixth") or []
    extra_sixth = [str(n) for n in json.loads(extra_raw) if isinstance(extra_raw, str)] if isinstance(extra_raw, str) else [str(n) for n in extra_raw]

    if digits == special:
        return {"name": "特別獎", "amount": 10000000}
    if digits == grand:
        return {"name": "特獎", "amount": 2000000}
    for first_number in first:
        if digits == first_number:
            return {"name": "頭獎", "amount": 200000}
    for suffix_len, name, amount in _SUFFIX_PRIZES:
        for first_number in first:
            if digits[-suffix_len:] == first_number[-suffix_len:]:
                return {"name": name, "amount": amount}
    for extra in extra_sixth:
        if digits[-3:] == extra[-3:]:
            return {"name": "增開六獎", "amount": 200}
    return None


def _create_win_notification(invoice: Invoice, prize: dict):
    """中獎通知；同一張發票同一期不重複產生。"""
    label = period_label(invoice.period)
    prefix = f"恭喜中獎！{label}"
    title = f"{prefix} {prize['name']}"
    exists = Notification.query.filter(
        Notification.user_id == invoice.user_id,
        Notification.type == "lottery_win",
        Notification.invoice_id == invoice.id,
        Notification.title.like(f"{prefix}%"),
    ).first()
    if exists is not None:
        return

    seller = (invoice.seller or "").strip()
    seller_part = f"（{seller}）" if seller else ""
    number_display = f"{invoice.number[:2]}-{invoice.number[2:]}"
    body = (
        f"發票 {number_display}{seller_part}對中{prize['name']} "
        f"NT${prize['amount']:,}，請在領獎期限內兌領。"
    )
    db.session.add(
        Notification(
            user_id=invoice.user_id,
            type="lottery_win",
            title=title,
            body=body,
            invoice_id=invoice.id,
        )
    )


def check_invoice(invoice: Invoice) -> bool:
    """對單張發票對獎（只比對發票所屬期別的獎號）。

    回傳是否「新中獎」（從非 won 變成 won）；中獎時會建立通知。
    """
    draw = db.session.get(LotteryDraw, invoice.period)
    if draw is None:
        # 該期還沒開獎，維持 pending
        invoice.prize_status = "pending"
        invoice.prize_name = None
        invoice.prize_amount = 0
        invoice.checked_at = None
        return False

    invoice.checked_at = utcnow()
    prize = match_prize(invoice.number, draw)
    if prize is None:
        invoice.prize_status = "not_won"
        invoice.prize_name = None
        invoice.prize_amount = 0
        return False

    newly_won = invoice.prize_status != "won"
    invoice.prize_status = "won"
    invoice.prize_name = prize["name"]
    invoice.prize_amount = prize["amount"]
    if newly_won:
        _create_win_notification(invoice, prize)
    return newly_won


def check_period_for_all_users(period: str) -> int:
    """對所有使用者該期的發票對獎，回傳新中獎張數。"""
    invoices = Invoice.query.filter_by(period=period).all()
    won_count = 0
    for invoice in invoices:
        if check_invoice(invoice):
            won_count += 1
    db.session.commit()
    return won_count


def ensure_fresh_draws(force: bool = False) -> list[str]:
    """需要時（沒有任何獎號、或超過 LOTTERY_REFRESH_HOURS）抓 RSS 更新獎號。

    回傳新加入的期別，並對這些期別的所有發票對獎。抓取失敗時沿用舊資料。
    """
    refresh_hours = float(current_app.config.get("LOTTERY_REFRESH_HOURS", 6))
    latest_fetched = db.session.query(func.max(LotteryDraw.fetched_at)).scalar()
    if not force and latest_fetched is not None:
        if utcnow() - latest_fetched < timedelta(hours=refresh_hours):
            return []

    try:
        items = parse_rss(fetch_rss())
    except Exception as exc:  # 網路或解析失敗都沿用舊資料
        current_app.logger.warning("抓取統一發票獎號失敗，沿用資料庫舊資料：%s", exc)
        return []

    new_periods = []
    for item in items:
        draw = db.session.get(LotteryDraw, item["period"])
        if draw is None:
            draw = LotteryDraw(period=item["period"])
            db.session.add(draw)
            new_periods.append(item["period"])
        draw.special = item["special"]
        draw.grand = item["grand"]
        draw.first = json.dumps(item["first"])
        draw.extra_sixth = json.dumps(item["extra_sixth"])
        draw.published_at = item["published_at"]
        draw.fetched_at = utcnow()
    try:
        db.session.commit()
    except IntegrityError:
        # 另一個請求同時寫入了同一期，交給它處理對獎
        db.session.rollback()
        return []

    for period in new_periods:
        check_period_for_all_users(period)
    return new_periods
