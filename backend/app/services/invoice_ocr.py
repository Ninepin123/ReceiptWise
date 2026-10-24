"""發票照片文字辨識：RapidOCR（PaddleOCR 的 ONNX 版）多輪縮放辨識，再解析成發票欄位。"""
import re
import threading
import time
import unicodedata
from datetime import date

from app.utils import period_parts

# 每一輪把圖等比例縮到「最長邊 = 這個值」再辨識；實測不同縮放讀得到的欄位不一樣
OCR_PASSES = (2000, 1330)
# 核心欄位都讀到就提早結束
CORE_FIELDS = ("number", "date", "randomCode", "totalAmount", "sellerId")
# parse_invoice_text / merge_results 處理的欄位
FIELD_KEYS = ("number", "date", "randomCode", "totalAmount", "sellerId", "period", "invoiceType")

# 各種破折號統一成 -（NFKC 不會轉換這幾個）
_DASHES = str.maketrans("－—–‒―", "-----")
NUMBER_RE = re.compile(r"([A-Z]{2})-?(\d{8})(?!\d)")
PERIOD_RE = re.compile(r"(\d{3})年(\d{1,2})-(\d{1,2})月")
WESTERN_DATE_RE = re.compile(r"(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})")
ROC_DATE_RE = re.compile(r"(1\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?")
RANDOM_CODE_RE = re.compile(r"[隨随隧機机碼码碣][^\d\n]{0,3}(\d{4})(?!\d)")
TOTAL_RE = re.compile(r"[總总計计十][^\d\n]{0,3}(\d{1,7})(?!\d)")
SELLER_ID_RE = re.compile(r"方[^\d\n]{0,3}(\d{8})(?!\d)")
UBN_WEIGHTS = (1, 2, 1, 2, 1, 2, 4, 1)


class OcrUnavailable(Exception):
    """伺服器沒有安裝文字辨識套件（rapidocr_onnxruntime）。"""


_engine = None  # lazy singleton，第一次用到才載入模型（約 1.5 秒）
_engine_lock = threading.Lock()


def _run_ocr(img) -> list:
    """建立引擎（第一次）並跑一輪 OCR，回傳 [box, text, score] 的列表。

    引擎的載入和推論都放在鎖裡（不是執行緒安全，dev server 又是多執行緒）。
    """
    global _engine
    with _engine_lock:
        if _engine is None:
            try:
                from rapidocr_onnxruntime import RapidOCR
            except ImportError as exc:
                raise OcrUnavailable("伺服器沒有安裝文字辨識套件") from exc
            _engine = RapidOCR()
        result, _ = _engine(img)
    return result or []


def decode_image(data: bytes):
    """bytes → BGR 影像（JPEG 會自動套用 EXIF 方向）；解不出來丟 ValueError。"""
    import cv2
    import numpy as np

    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("無法讀取圖片")
    return img


def _scale_to_longest_side(img, max_side: int):
    """等比例縮到最長邊 = max_side（原圖比較小就不放大）。"""
    import cv2

    height, width = img.shape[:2]
    longest = max(height, width)
    if longest <= max_side:
        return img
    ratio = max_side / longest
    return cv2.resize(img, (round(width * ratio), round(height * ratio)), interpolation=cv2.INTER_AREA)


def is_valid_ubn(s: str) -> bool:
    """台灣統一編號檢查碼：乘積取十位數加個位數加總成 Z，Z 能被 5 整除就合法；
    第 7 碼是 7 時（Z+1）能被 5 整除也合法（2023 年起的規則，相容舊制的 % 10）。"""
    s = str(s or "")
    if not re.fullmatch(r"\d{8}", s):
        return False
    total = 0
    for digit, weight in zip(map(int, s), UBN_WEIGHTS):
        product = digit * weight
        total += product // 10 + product % 10
    if total % 5 == 0:
        return True
    return s[6] == "7" and (total + 1) % 5 == 0


def _normalize(line: str) -> str:
    """NFKC（全形轉半形、`：` 變 `:`）、破折號統一成 `-`、去掉空白；保留行的結構。"""
    text = unicodedata.normalize("NFKC", str(line or ""))
    text = text.translate(_DASHES)
    return re.sub(r"\s+", "", text)


def _safe_iso_date(year: int, month: int, day: int) -> str | None:
    """合法日期 → YYYY-MM-DD；不合法回 None。"""
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def _first_match(rows: list[str], pattern) -> re.Match | None:
    for row in rows:
        m = pattern.search(row)
        if m:
            return m
    return None


def _find_date(rows: list[str]) -> str | None:
    """先找西元日期（電子發票），找不到再找民國日期（傳統發票）。"""
    m = _first_match(rows, WESTERN_DATE_RE)
    if m:
        found = _safe_iso_date(int(m[1]), int(m[2]), int(m[3]))
        if found:
            return found
    for row in rows:
        # 期別「115年09-10月」長得像民國日期，先遮掉再找
        m = ROC_DATE_RE.search(PERIOD_RE.sub("□", row))
        if m:
            found = _safe_iso_date(int(m[1]) + 1911, int(m[2]), int(m[3]))
            if found:
                return found
    return None


def parse_invoice_text(lines: list[str]) -> dict:
    """OCR 文字行 → 發票欄位（純函式），讀不到的欄位是 None。

    OCR 常把中文標籤讀成形近字（隨機碼→「随機」「隧機碣」、總計→「總计」「信十」、
    賣方→「黄方」「魔方」），所以主要靠數字格式判斷，標籤只比對一個寬鬆的字。
    """
    rows = [row for row in (_normalize(line) for line in lines) if row]
    fields = dict.fromkeys(FIELD_KEYS)
    fields["invoiceType"] = "electronic" if any("電子" in row for row in rows) else "unknown"

    m = _first_match(rows, PERIOD_RE)
    if m and int(m[2]) % 2 == 1 and int(m[3]) == int(m[2]) + 1:
        # 必須是「奇數月-下一個偶數月」，格式同 date_to_period（3 碼民國年 + 奇數月）
        fields["period"] = f"{int(m[1]):03d}{int(m[2]):02d}"

    fields["date"] = _find_date(rows)

    m = _first_match(rows, NUMBER_RE)
    if m:
        fields["number"] = m[1] + m[2]  # 不含破折號

    m = _first_match(rows, RANDOM_CODE_RE)
    if m:
        fields["randomCode"] = m[1]

    m = _first_match(rows, TOTAL_RE)
    if m:
        fields["totalAmount"] = int(m[1])

    # 賣方統編要通過檢查碼才採用（同一行可能還有買方等其他 8 碼數字）
    for row in rows:
        for m in SELLER_ID_RE.finditer(row):
            if is_valid_ubn(m[1]):
                fields["sellerId"] = m[1]
                break
        if fields["sellerId"]:
            break

    # 日期和期別都有、但日期不在該期的兩個月內 → 寧可留空也不要填錯
    if fields["date"] and fields["period"]:
        roc, first_month = period_parts(fields["period"])
        d = date.fromisoformat(fields["date"])
        if d.year != roc + 1911 or d.month not in (first_month, first_month + 1):
            fields["date"] = None

    return fields


def merge_results(results: list[dict]) -> dict:
    """依輪次順序合併，每個欄位取第一個非 None 的值。"""
    merged = dict.fromkeys(FIELD_KEYS)
    for result in results:
        for key in FIELD_KEYS:
            if merged[key] is None and result.get(key) is not None:
                merged[key] = result[key]
    return merged


def recognize_invoice(data: bytes) -> dict:
    """圖片 bytes → 發票欄位：decode → 每輪縮放辨識加解析 → 合併。"""
    started = time.perf_counter()
    img = decode_image(data)

    results = []
    for max_side in OCR_PASSES:
        scaled = _scale_to_longest_side(img, max_side)
        lines = [row[1] for row in _run_ocr(scaled)]
        fields = parse_invoice_text(lines)
        results.append(fields)
        if all(fields[key] is not None for key in CORE_FIELDS):
            break  # 核心欄位都拿到了，不用再跑下一輪

    merged = merge_results(results)
    merged["found"] = merged["number"] is not None or merged["totalAmount"] is not None
    merged["missing"] = [key for key in CORE_FIELDS if merged[key] is None]
    merged["elapsedMs"] = round((time.perf_counter() - started) * 1000)
    return merged
