"""統一錯誤格式：{"error": "<代碼>", "message": "<中文說明>"}，驗證錯誤可加 "fields"。"""
from flask import jsonify
from werkzeug.exceptions import HTTPException


class ApiError(Exception):
    """自訂 API 錯誤，直接在 view 裡 raise。"""

    def __init__(self, code: str, message: str, status: int = 400, fields: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.fields = fields


# werkzeug HTTP 狀態 → (error 代碼, 中文訊息)
_HTTP_MESSAGES = {
    404: ("not_found", "找不到資源"),
    405: ("method_not_allowed", "不支援的請求方法"),
    400: ("validation_error", "請求格式不正確"),
    413: ("validation_error", "請求內容過大"),
    415: ("validation_error", "不支援的內容格式"),
}


def register_error_handlers(app):
    @app.errorhandler(ApiError)
    def handle_api_error(err: ApiError):
        body = {"error": err.code, "message": err.message}
        if err.fields:
            body["fields"] = err.fields
        return jsonify(body), err.status

    @app.errorhandler(HTTPException)
    def handle_http_exception(err: HTTPException):
        code, message = _HTTP_MESSAGES.get(err.code, ("error", err.description or "發生錯誤"))
        return jsonify({"error": code, "message": message}), err.code or 500

    @app.errorhandler(Exception)
    def handle_unexpected(err: Exception):
        app.logger.exception("未預期的錯誤：%s", err)
        return jsonify({"error": "internal_error", "message": "伺服器發生錯誤，請稍後再試"}), 500


def register_jwt_error_handlers(jwt):
    """所有 token 相關錯誤一律 401 unauthorized。"""

    def unauthorized(message):
        return jsonify({"error": "unauthorized", "message": message}), 401

    jwt.unauthorized_loader(lambda _: unauthorized("請先登入"))
    jwt.invalid_token_loader(lambda _: unauthorized("登入資訊無效，請重新登入"))
    jwt.expired_token_loader(lambda *_: unauthorized("登入已過期，請重新登入"))
    jwt.revoked_token_loader(lambda _: unauthorized("登入已失效，請重新登入"))
    jwt.user_lookup_error_loader(lambda _: unauthorized("找不到使用者，請重新登入"))
    jwt.needs_fresh_token_loader(lambda _: unauthorized("需要重新登入"))
