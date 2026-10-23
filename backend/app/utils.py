"""共用工具：期別換算、發票號碼正規化、時間處理、驗證。行為要和前端 utils/period.js 一致。"""
import re
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

TAIPEI = ZoneInfo("Asia/Taipei")
INVOICE_NUMBER_RE = re.compile(r"^[A-Z]{2}\d{8}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def utcnow() -> datetime:
    """現在的 UTC 時間（存進資料庫用，不帶時區資訊）。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def iso_z(dt: datetime | None) -> str | None:
    """datetime 轉 ISO 8601（UTC、結尾 Z）；None 回 None。"""
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def today_taipei() -> date:
    """Asia/Taipei 的今天。"""
    return datetime.now(TAIPEI).date()


def normalize_invoice_number(raw: str) -> str:
    """去掉空白和連字號、轉大寫，例如 `ab-12345678` → `AB12345678`。"""
    return re.sub(r"[\s\-－—]+", "", str(raw or "")).upper()


def is_valid_invoice_number(number: str) -> bool:
    return bool(INVOICE_NUMBER_RE.match(number or ""))


def parse_date(value) -> date | None:
    """剖析 `YYYY-MM-DD`，格式不對或日期不合法回 None。"""
    if not isinstance(value, str) or not DATE_RE.match(value):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def date_to_period(d: date) -> str:
    """西元日期 → 5 碼期別（3 碼民國年 + 該期第一個奇數月）。"""
    roc = d.year - 1911
    first_month = d.month if d.month % 2 == 1 else d.month - 1
    return f"{roc:03d}{first_month:02d}"


def period_parts(period: str) -> tuple[int, int]:
    """期別 → (民國年, 第一個月)。"""
    return int(period[:3]), int(period[3:])


def period_label(period: str) -> str:
    """期別 → 顯示名稱，例如 `11509` → `115年 09-10月`。"""
    roc, first = period_parts(period)
    return f"{roc}年 {first:02d}-{first + 1:02d}月"


def period_draw_date(period: str) -> date:
    """期別 → 開獎日（該期第二個月的下個月 25 日，注意跨年）。"""
    roc, first = period_parts(period)
    year = roc + 1911
    month = first + 2
    if month > 12:
        year, month = year + 1, month - 12
    return date(year, month, 25)


def previous_period(period: str) -> str:
    """上一期，例如 `11501` → `11411`。"""
    roc, first = period_parts(period)
    if first == 1:
        return f"{roc - 1:03d}11"
    return f"{roc:03d}{first - 2:02d}"


def next_draw(today: date) -> dict:
    """還沒開獎的最近一期：開獎日 >= 今天且最早的期別（開獎當天仍算還沒開獎）。"""
    current = date_to_period(today)
    for period in (previous_period(current), current):
        draw_date = period_draw_date(period)
        if draw_date >= today:
            return {
                "period": period,
                "label": period_label(period),
                "drawDate": draw_date.isoformat(),
            }
    # 當前期開獎日必定 >= 今天，這裡只是保險
    return {
        "period": current,
        "label": period_label(current),
        "drawDate": period_draw_date(current).isoformat(),
    }
