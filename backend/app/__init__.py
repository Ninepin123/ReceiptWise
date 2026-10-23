"""應用程式工廠。"""
import os

from flask import Flask, abort, jsonify, request, send_from_directory
from flask_cors import CORS

from app.config import INSTANCE_DIR, Config
from app.errors import register_error_handlers, register_jwt_error_handlers
from app.extensions import db, jwt


def create_app(config_overrides: dict | None = None) -> Flask:
    app = Flask(__name__)
    app.config.from_object(Config)
    if config_overrides:
        app.config.update(config_overrides)
    app.json.sort_keys = False

    # 沒設定金鑰時用開發用預設值，要明顯警告
    if not os.environ.get("SECRET_KEY"):
        app.logger.warning("SECRET_KEY 未設定，使用開發用預設值；正式環境一定要設定")
    if not os.environ.get("JWT_SECRET_KEY"):
        app.logger.warning("JWT_SECRET_KEY 未設定，使用開發用預設值；正式環境一定要設定")

    db.init_app(app)
    jwt.init_app(app)
    CORS(app, resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}})

    register_jwt_error_handlers(jwt)
    register_error_handlers(app)

    from app.api.auth import bp as auth_bp
    from app.api.invoices import bp as invoices_bp
    from app.api.lottery import bp as lottery_bp
    from app.api.notifications import bp as notifications_bp
    from app.api.transactions import bp as transactions_bp

    for blueprint in (auth_bp, transactions_bp, invoices_bp, lottery_bp, notifications_bp):
        app.register_blueprint(blueprint, url_prefix="/api")

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok"})

    # 正式環境：FRONTEND_DIST 存在時，非 /api 路徑回靜態檔（SPA fallback）
    frontend_dist = app.config.get("FRONTEND_DIST")
    if frontend_dist and os.path.isdir(frontend_dist):
        @app.route("/", defaults={"path": ""})
        @app.route("/<path:path>")
        def spa(path):
            if request.path.startswith("/api/"):
                abort(404)  # /api 找不到要回 JSON 404，不能回 index.html
            if path and os.path.isfile(os.path.join(frontend_dist, path)):
                return send_from_directory(frontend_dist, path)
            return send_from_directory(frontend_dist, "index.html")

    @app.cli.command("lottery-sync")
    def lottery_sync():
        """強制抓取最新獎號並對所有使用者的發票對獎。"""
        from app.services.lottery import ensure_fresh_draws

        new_periods = ensure_fresh_draws(force=True)
        if new_periods:
            print("新增期別：" + "、".join(new_periods))
        else:
            print("沒有新增期別")

    from app.seed import seed_demo

    app.cli.add_command(seed_demo)

    # SQLite 預設放在 instance/，資料夾不存在就建立
    os.makedirs(INSTANCE_DIR, exist_ok=True)
    with app.app_context():
        db.create_all()

    return app
