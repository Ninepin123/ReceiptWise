# ReceiptWise（雲帳 CloudLedger）

以台灣電子發票為核心的雲端記帳網頁。手機和電腦都能用，資料存在雲端、可以跨裝置同步；也可以安裝到手機桌面（PWA）。

## 功能

- **收支記帳**：新增、編輯、刪除、搜尋、依月份與類型篩選。
- **儀表板**：切換月份查看收入、支出、結餘、發票張數；支出分類圓餅圖（含百分比）；近 6／12 個月收支趨勢，自動標出開銷高峰月份；和上個月比較。
- **掃描發票**：
  - 相機掃描電子發票證明聯的左右 QR Code 與一維條碼（zxing-wasm 引擎，離線可用），把整張發票放進框內、距離約 10–15 公分即可，自動帶入號碼、日期、隨機碼、金額、賣方統編與品項；讀到一維條碼時會先等一下看能不能掃到含金額的左側 QR Code。
  - 拍照或上傳圖片解析，用原圖解析度加上對比加強重試，光線差的照片也解得動（手機用 http 區網網址開啟、沒有相機權限時也能用）。
  - 條碼讀不到（例如摺痕讓 QR Code 變形）時，自動改用伺服器端文字辨識（RapidOCR，跑在自己的伺服器、免費、不用外部服務）讀出印在發票上的文字；相機模式也可以按「讀不到？拍下來辨識文字」。辨識結果會標出沒讀到或推測的欄位，請核對後再儲存。
  - 傳統統一發票（收銀機、手開）沒有條碼，請用手動補登。
  - 確認後同時建立發票和一筆支出。
- **手動補登**：有統一發票號碼的紙本發票，或沒有發票的一般收據，都能手動輸入。
- **自動對獎**：後端定期抓財政部公布的中獎號碼，依完整規則（特別獎～六獎）自動對獎；中獎時在 App 內通知（鈴鐺、橫幅），開啟後網頁開著也會跳出系統通知。
- **離線也能記帳**：資料先存在瀏覽器，連線恢復後自動同步。
- **帳號**：註冊、登入（JWT），每個人只看得到自己的資料。

## 專案結構

```
ReceiptWise/
├── docs/ARCHITECTURE.md   # 架構、API 規格、資料模型、對獎規則、條碼格式
├── backend/               # Flask 3 REST API（SQLite，可換 PostgreSQL）
└── frontend/              # Vue 3 + Vite + Pinia + Chart.js（PWA）
```

詳細設計請看 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 開發環境啟動

需要 Python 3.11 以上與 Node.js 18 以上。以下指令以 Windows 為例（macOS／Linux 把 `.venv/Scripts/python` 換成 `.venv/bin/python`）。

```bash
# 1. 後端（第一次要建立虛擬環境）
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python -m flask --app wsgi seed-demo      # 選用：建立示範帳號與半年份資料
.venv/Scripts/python -m flask --app wsgi run --port 5000

# 2. 前端（另開一個終端機）
cd frontend
npm install
npm run dev
```

開啟 http://localhost:5173 。前端開發伺服器會把 `/api` 轉到 `127.0.0.1:5000`。

示範帳號（執行 `seed-demo` 後）：`demo@receiptwise.test` / `demo12345`。示範資料裡有一張 115 年 07–08 月對中六獎的發票，進「發票對獎」頁就會看到。

### 用手機測試

`npm run dev` 會同時監聽區網 IP（終端機會印出 `Network: http://192.168.x.x:5173`），手機連同一個 Wi-Fi 就能開。注意：瀏覽器只允許 HTTPS 或 localhost 使用相機，所以用區網網址時請改用「拍照・上傳圖片」模式；正式部署到 HTTPS 後就能直接用相機掃描。

## 測試

```bash
cd backend && .venv/Scripts/python -m pytest -q    # 後端 API、對獎規則、RSS 解析
cd frontend && npm test                            # 條碼解析、期別換算、統計、離線同步
```

## 正式部署

1. `cd frontend && npm run build`，產生 `frontend/dist/`。
2. 設定環境變數（見 `backend/.env.example`），至少要設定 `SECRET_KEY`、`JWT_SECRET_KEY`；資料庫可用 `DATABASE_URL` 指向 PostgreSQL。
3. 用 WSGI 伺服器啟動 `backend/wsgi.py`（例如 `gunicorn wsgi:app`）。Flask 會同時提供 `/api` 和前端靜態檔。
4. 一定要用 HTTPS，相機掃描和 PWA 安裝才會正常。
5. 獎號會在有人打開對獎頁時自動檢查是否需要更新（最多每 6 小時抓一次）。想讓開獎當天就自動對獎並通知，可以用系統排程每天執行 `flask --app wsgi lottery-sync`。

## 獎號資料來源

財政部稅務入口網的統一發票中獎號碼 RSS（`https://invoice.etax.nat.gov.tw/invoice.xml`），提供最近 6 期。中獎結果僅供參考，請以財政部公告為準。
