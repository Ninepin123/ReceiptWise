"""OCR 文字行解析、統編檢查碼、多輪合併，以及 /api/invoices/ocr 的行為。"""
import io
import json
import os

import pytest

from app.services.invoice_ocr import (
    is_valid_ubn,
    merge_results,
    parse_invoice_text,
)

FIXTURES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")

# 三張真實照片兩輪（2000 → 1330）合併後應該得到的欄位
EXPECTED = {
    "IMG_6397": {
        "number": "FL70604278",
        "date": "2026-10-10",
        "randomCode": "7596",
        "totalAmount": 70,
        "sellerId": "00087966",
        "period": "11509",
        "invoiceType": "electronic",
    },
    "IMG_6398": {
        "number": None,
        "date": None,
        "randomCode": "9278",
        "totalAmount": 35,
        "sellerId": "88006140",
        "period": None,
        "invoiceType": "electronic",
    },
    "IMG_6399": {
        "number": "EU34069942",
        "date": "2026-09-18",
        "randomCode": "5794",
        "totalAmount": 251,
        "sellerId": "96848573",
        "period": "11509",
        "invoiceType": "electronic",
    },
}


def _merged_lines(name: str) -> dict:
    with open(os.path.join(FIXTURES_DIR, "ocr_lines.json"), encoding="utf-8") as f:
        passes = json.load(f)[name]
    return merge_results([parse_invoice_text(passes["2000"]), parse_invoice_text(passes["1330"])])


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_real_photo_lines_merged(name):
    assert _merged_lines(name) == EXPECTED[name]


def test_merge_results_takes_first_non_null():
    base = dict.fromkeys(("number", "date", "randomCode", "totalAmount", "sellerId", "period", "invoiceType"))
    merged = merge_results([
        {**base, "date": "2026-10-10", "randomCode": "1111", "totalAmount": 1},
        {**base, "number": "AB12345678", "date": "2026-09-18", "sellerId": "12345675", "invoiceType": "electronic"},
    ])
    assert merged["number"] == "AB12345678"
    assert merged["date"] == "2026-10-10"  # 第一輪的值優先
    assert merged["randomCode"] == "1111"
    assert merged["sellerId"] == "12345675"
    assert merged["invoiceType"] == "electronic"


def test_valid_ubns():
    assert is_valid_ubn("00087966")
    assert is_valid_ubn("88006140")
    assert is_valid_ubn("96848573")  # 第 7 碼是 7 的規則


def test_invalid_ubns():
    assert not is_valid_ubn("88006141")  # 檢查碼不合
    assert not is_valid_ubn("1234567")  # 不是 8 碼
    assert not is_valid_ubn("123456789")
    assert not is_valid_ubn("1234567a")
    assert not is_valid_ubn("")


def test_fullwidth_digits_and_colon():
    fields = parse_invoice_text(["ＦＬ－７０６０４２７８", "總計：７０", "隨機碼：７５９６"])
    assert fields["number"] == "FL70604278"
    assert fields["totalAmount"] == 70
    assert fields["randomCode"] == "7596"


def test_roc_date_supported():
    assert parse_invoice_text(["114-12-31"])["date"] == "2025-12-31"
    assert parse_invoice_text(["115年9月18日"])["date"] == "2026-09-18"
    assert parse_invoice_text(["115.9.18"])["date"] == "2026-09-18"


def test_period_string_not_mistaken_as_date():
    fields = parse_invoice_text(["115年09-10月"])
    assert fields["period"] == "11509"
    assert fields["date"] is None

    fields = parse_invoice_text(["115年09-10月", "115年9月18日"])
    assert fields["date"] == "2026-09-18"


def test_invalid_period_shapes_rejected():
    assert parse_invoice_text(["115年10-11月"])["period"] is None  # 第一個月不是奇數
    assert parse_invoice_text(["115年09-11月"])["period"] is None  # 不是接續的兩個月


def test_illegal_date_rejected():
    assert parse_invoice_text(["2026-02-30 08:00:00"])["date"] is None
    assert parse_invoice_text(["2026-13-01"])["date"] is None


def test_time_not_random_code():
    fields = parse_invoice_text(["2026-10-10 12:28:48"])
    assert fields["date"] == "2026-10-10"
    assert fields["randomCode"] is None


def test_date_outside_period_dropped():
    fields = parse_invoice_text(["115年09-10月", "2026-08-05 10:00:00"])
    assert fields["period"] == "11509"
    assert fields["date"] is None  # 8 月不在 11509 期（9-10 月）內


def test_seller_id_requires_valid_ubn():
    assert parse_invoice_text(["賣方：88006141"])["sellerId"] is None
    assert parse_invoice_text(["賣方：88006140"])["sellerId"] == "88006140"


def test_invoice_type():
    assert parse_invoice_text(["電子發票證明聯"])["invoiceType"] == "electronic"
    assert parse_invoice_text(["收銀機統一發票"])["invoiceType"] == "unknown"


# ---------- API ----------

def post_ocr(client, headers, content=b"fake-image", mimetype="image/jpeg"):
    return client.post(
        "/api/invoices/ocr",
        data={"image": (io.BytesIO(content), "photo.jpg", mimetype)},
        content_type="multipart/form-data",
        headers=headers,
    )


def test_api_ocr_success(client, auth_headers, monkeypatch):
    from app.api import invoices as invoices_api

    canned = {
        "number": "FL70604278", "date": "2026-10-10", "randomCode": "7596",
        "totalAmount": 70, "sellerId": "00087966", "period": "11509",
        "invoiceType": "electronic", "found": True, "missing": [], "elapsedMs": 1234,
    }
    monkeypatch.setattr(invoices_api, "recognize_invoice", lambda data: canned)
    resp = post_ocr(client, auth_headers)
    assert resp.status_code == 200
    assert resp.get_json() == {"result": canned}


def test_api_ocr_requires_token(client):
    assert post_ocr(client, {}).status_code == 401


def test_api_ocr_missing_file(client, auth_headers):
    resp = client.post("/api/invoices/ocr", data={}, content_type="multipart/form-data", headers=auth_headers)
    assert resp.status_code == 400
    body = resp.get_json()
    assert body["error"] == "validation_error"
    assert body["fields"] == {"image": "請上傳圖片"}


def test_api_ocr_wrong_mimetype(client, auth_headers):
    resp = post_ocr(client, auth_headers, mimetype="text/plain")
    assert resp.status_code == 400
    assert "image" in resp.get_json()["fields"]


def test_api_ocr_too_large(client, auth_headers):
    resp = post_ocr(client, auth_headers, content=b"x" * (8 * 1024 * 1024 + 1))
    assert resp.status_code == 413
    assert resp.get_json()["message"] == "圖片太大（上限 8MB）"


def test_api_ocr_unavailable(client, auth_headers, monkeypatch):
    from app.api import invoices as invoices_api
    from app.services.invoice_ocr import OcrUnavailable

    def boom(data):
        raise OcrUnavailable("伺服器沒有安裝文字辨識套件")

    monkeypatch.setattr(invoices_api, "recognize_invoice", boom)
    resp = post_ocr(client, auth_headers)
    assert resp.status_code == 503
    body = resp.get_json()
    assert body["error"] == "ocr_unavailable"
    assert body["message"] == "伺服器沒有安裝文字辨識套件"


def test_api_ocr_garbage_image(client, auth_headers):
    # 亂碼 bytes：用真的 decode_image 解不出圖 → 400
    resp = post_ocr(client, auth_headers, content=b"this is definitely not an image")
    assert resp.status_code == 400
    assert resp.get_json()["fields"] == {"image": "無法讀取圖片"}


def test_recognize_invoice_on_synthetic_image():
    """有裝 rapidocr 才跑：畫一張白底黑字圖，確認整條流程真的讀得到欄位。"""
    pytest.importorskip("rapidocr_onnxruntime")
    import cv2
    import numpy as np

    from app.services.invoice_ocr import recognize_invoice

    img = np.full((760, 1100, 3), 255, dtype=np.uint8)
    cv2.putText(img, "FL-70604278", (40, 220), cv2.FONT_HERSHEY_SIMPLEX, 2.5, (0, 0, 0), 5)
    cv2.putText(img, "2026-10-10 12:28:48", (40, 480), cv2.FONT_HERSHEY_SIMPLEX, 2.5, (0, 0, 0), 5)
    ok, buf = cv2.imencode(".jpg", img)
    assert ok

    result = recognize_invoice(buf.tobytes())
    assert result["number"] == "FL70604278"
    assert result["date"] == "2026-10-10"
    assert result["found"] is True
    assert isinstance(result["elapsedMs"], int)
