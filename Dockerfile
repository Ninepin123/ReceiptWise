# ---------- 階段一：建置前端（Vue 3 + Vite） ----------
FROM node:22-alpine AS frontend-build

WORKDIR /src/frontend

# 先只複製依賴清單，讓 npm ci 可以吃到 layer 快取
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# 再複製原始碼建置，產生 dist/
COPY frontend/ ./
RUN npm run build

# ---------- 階段二：執行環境（Flask + gunicorn） ----------
FROM python:3.12-slim

# 非 root 執行（uid 1000）
RUN useradd --create-home --uid 1000 app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app/backend

# 先複製 requirements.txt 再 pip install，利用 layer 快取
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 後端程式；前端產物放到 ../frontend/dist（FRONTEND_DIST 的預設路徑）
COPY backend/ ./
COPY --from=frontend-build /src/frontend/dist /app/frontend/dist

# SQLite 資料庫位置；Coolify 永久儲存會掛在這裡，先建好並給對擁有者
RUN mkdir -p /app/backend/instance && chown app:app /app/backend/instance

USER app

EXPOSE 5000

# SQLite 只允許單一寫入者：固定 1 個 worker，用 threads 處理並行
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "8", \
     "--access-logfile", "-", "--error-logfile", "-", "wsgi:app"]

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5000/api/health', timeout=3)"]
