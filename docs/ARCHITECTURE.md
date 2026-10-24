# ReceiptWise 架構說明

雲帳 CloudLedger（ReceiptWise）：以台灣電子發票為核心的記帳網頁。手機和電腦都能用，資料存在雲端，可以跨裝置同步。

本文件是所有開發工作的共同規格。前端和後端都照這份文件的 API 規格實作；要改規格時，先改這份文件。

---

## 1. 整體架構

```
┌──────────────── 瀏覽器（手機 / 電腦）────────────────┐
│ Vue 3 + Vite（PWA，可安裝到手機桌面）                  │
│                                                       │
│  views/      頁面                                     │
│  stores/     Pinia：auth / ledger / lottery / notifications │
│  utils/      純函式：發票 QR 解析、期別換算、統計計算   │
│  api/        fetch 包裝（帶 JWT）                      │
│  localStorage：資料快取 + 離線待同步佇列（outbox）      │
└───────────────────────┬───────────────────────────────┘
                        │ /api/*（JSON，Bearer JWT）
                        │ 開發時由 Vite proxy 轉到 127.0.0.1:5000
┌───────────────────────▼───────────────────────────────┐
│ Flask 3 REST API                                       │
│  api/       auth / transactions / invoices / lottery / notifications │
│  services/  lottery.py：抓財政部 RSS、對獎規則、產生通知 │
│  發票 OCR   RapidOCR（rapidocr_onnxruntime，選配；沒裝回 503）│
│  models.py  SQLAlchemy                                 │
│  SQLite（開發）→ 可用 DATABASE_URL 換 PostgreSQL        │
│  正式環境：Flask 同時提供 frontend/dist 靜態檔          │
└───────────────────────┬───────────────────────────────┘
                        │ 每 6 小時最多抓一次（有請求時才檢查）
                        ▼
        https://invoice.etax.nat.gov.tw/invoice.xml
        （財政部統一發票中獎號碼 RSS，最近 6 期）
```

### 設計決策

| 決策 | 原因 |
| --- | --- |
| 主鍵用前端產生的 UUID（`crypto.randomUUID()`） | 離線新增時不需要等伺服器給 id，離線佇列重送時也不會重複建立。 |
| 新增和修改都用 `PUT /api/<資源>/<id>`（upsert） | 重送同一個操作結果相同（idempotent），離線同步最簡單。 |
| `DELETE` 找不到資料也回 204 | 離線佇列重送刪除時不會卡住。 |
| 統計（月總覽、圓餅圖、趨勢）在前端用 `utils/stats.js` 計算 | 個人記帳資料量小，前端全量載入即可；離線時圖表也能顯示；計算邏輯只有一份。 |
| 對獎在後端做 | 抓 RSS 會被瀏覽器 CORS 擋住；新獎號公布時要能替所有使用者對獎並產生通知。 |
| 獎號來源用財政部 RSS，不用電子發票平台 API | RSS 免申請 AppID，內容有特別獎、特獎、頭獎，足以推算二獎到六獎。 |
| 沒有背景排程器，改成「有請求時檢查是否超過 6 小時」＋ CLI 指令 | 避免多個 worker 重複執行；需要時可用系統排程呼叫 `flask lottery-sync`。 |
| JWT 存在 localStorage，效期 30 天，不做 refresh token | 專案規模小，先求簡單。 |
| 中獎通知：App 內鈴鐺＋開著網頁時的瀏覽器通知（Notification API） | 需求是「推播或顯示」。關閉網頁也能收到的 Web Push 列為之後的擴充。 |

---

## 2. 目錄結構

```
ReceiptWise/
├── docs/ARCHITECTURE.md      ← 本文件
├── backend/
│   ├── requirements.txt
│   ├── .env.example
│   ├── wsgi.py               # from app import create_app; app = create_app()
│   ├── app/
│   │   ├── __init__.py       # create_app(config=None)
│   │   ├── config.py
│   │   ├── extensions.py     # db, jwt, cors
│   │   ├── models.py
│   │   ├── errors.py         # 統一錯誤格式
│   │   ├── utils.py          # 期別換算、驗證
│   │   ├── api/
│   │   │   ├── auth.py
│   │   │   ├── transactions.py
│   │   │   ├── invoices.py
│   │   │   ├── lottery.py
│   │   │   └── notifications.py
│   │   └── services/
│   │       └── lottery.py
│   └── tests/
│       ├── conftest.py
│       ├── fixtures/invoice.xml   # 真實 RSS 範本（2026-10 抓取）
│       └── test_*.py
└── frontend/
    ├── vite.config.js        # /api proxy、PWA
    └── src/
        ├── main.js / App.vue / router.js
        ├── constants.js      # 分類、分類顏色、localStorage key
        ├── api/client.js
        ├── stores/           # auth.js ledger.js lottery.js notifications.js
        ├── utils/            # einvoice.js period.js stats.js format.js（含 *.test.js）
        ├── components/
        ├── views/
        └── styles/
```

---

## 3. 資料模型（後端 SQLAlchemy）

金額一律用整數新台幣。日期欄位存 `YYYY-MM-DD` 字串或 `Date`，對外一律輸出 `YYYY-MM-DD`。時間戳記用 UTC，對外輸出 ISO 8601（結尾 `Z`）。

### User
| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| id | int PK | |
| email | str(255) unique | 存小寫、去空白 |
| password_hash | str | `werkzeug.security.generate_password_hash` |
| display_name | str(50) | |
| created_at | datetime | |

### Transaction（收支）
| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| id | str(36) PK | 前端產生的 UUID |
| user_id | FK User | |
| type | str | `expense` 或 `income` |
| title | str(100) | 必填 |
| category | str(20) | 必填 |
| amount | int | > 0 |
| date | date | |
| note | str(255) | 可空字串 |
| invoice_id | str(36) FK Invoice, nullable | 由發票建立的支出會連到發票 |
| created_at / updated_at | datetime | |

### Invoice（發票）
| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| id | str(36) PK | 前端產生的 UUID |
| user_id | FK User | |
| number | str(10) | `^[A-Z]{2}\d{8}$`，不含連字號。(user_id, number) unique |
| date | date | 開立日期 |
| period | str(5) | 伺服器依 date 算出，例如 `11509`（見第 6 節） |
| amount | int | >= 0，含稅總額 |
| seller | str(100) | 店家名稱，可空 |
| seller_id | str(8) | 賣方統編，可空 |
| random_code | str(4) | `^\d{4}$` 或空字串 |
| items | JSON text | `[{"name": str, "qty": number, "price": number}]` |
| source | str | `qr` / `barcode` / `manual` |
| prize_status | str | `pending`（尚未對獎）/ `not_won` / `won` |
| prize_name | str nullable | 例如 `六獎` |
| prize_amount | int | 未中獎為 0 |
| checked_at | datetime nullable | |
| created_at / updated_at | datetime | |

### LotteryDraw（每期獎號）
| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| period | str(5) PK | 例如 `11507` |
| special | str(8) | 特別獎 |
| grand | str(8) | 特獎 |
| first | JSON text | 頭獎，3 組 8 碼 |
| extra_sixth | JSON text | 增開六獎（3 碼），目前 RSS 沒有，預設 `[]` |
| published_at | datetime nullable | RSS 的 pubDate |
| fetched_at | datetime | |

### Notification
| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| id | int PK | |
| user_id | FK User | |
| type | str | 目前只有 `lottery_win` |
| title | str | |
| body | str | |
| invoice_id | str(36) nullable | |
| read | bool | 預設 False |
| created_at | datetime | |

---

## 4. REST API 規格

- 前綴 `/api`，請求和回應都是 JSON，欄位用 camelCase。
- 除了 `/api/health`、`/api/auth/register`、`/api/auth/login`，其他都要 `Authorization: Bearer <token>`。
- 每個查詢都只能看到、改到自己的資料。id 屬於別的使用者時，一律當作不存在（404），不能洩漏資料存在與否。
- 錯誤格式一律是：`{"error": "<代碼>", "message": "<給使用者看的中文說明>"}`

| HTTP | error 代碼 | 情境 |
| --- | --- | --- |
| 400 | `validation_error` | 欄位格式錯誤。可多帶 `"fields": {"amount": "金額必須大於 0"}` |
| 401 | `unauthorized` | 沒帶 token、token 無效或過期（要改寫 Flask-JWT-Extended 預設的錯誤回應） |
| 401 | `invalid_credentials` | 登入帳密錯誤 |
| 404 | `not_found` | |
| 409 | `email_taken` | 註冊時 email 已存在 |
| 409 | `duplicate_invoice` | 同一使用者的另一筆發票已用了這個號碼 |
| 502 | `lottery_unavailable` | 抓不到 RSS，而且資料庫也沒有任何獎號 |

### 4.1 Auth

**POST `/api/auth/register`** `{ "email", "password", "displayName" }`
- email 要符合基本格式；password 至少 8 個字元；displayName 1–50 字，沒填就用 email 的 @ 前面那段。
- 201 → `{ "token": "...", "user": User }`

**POST `/api/auth/login`** `{ "email", "password" }` → 200 `{ "token", "user" }`

**GET `/api/auth/me`** → 200 `{ "user": User }`

User 物件：`{ "id": 1, "email": "a@b.com", "displayName": "小明", "createdAt": "..." }`

JWT identity 用 `str(user.id)`，效期 30 天。

### 4.2 Transactions

Transaction 物件：
```json
{
  "id": "6f1c...uuid",
  "type": "expense",
  "title": "午餐便當",
  "category": "餐飲",
  "amount": 120,
  "date": "2026-10-19",
  "note": "",
  "invoiceId": null,
  "createdAt": "2026-10-19T04:00:00Z",
  "updatedAt": "2026-10-19T04:00:00Z"
}
```

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| GET | `/api/transactions` | `{ "transactions": [...] }`，依 date 新到舊、再依 createdAt 新到舊。可選 `?month=YYYY-MM` |
| PUT | `/api/transactions/<id>` | upsert。body 是 Transaction（`id`、`createdAt`、`updatedAt` 會被忽略）。新建回 201，更新回 200，回 `{ "transaction": ... }` |
| DELETE | `/api/transactions/<id>` | 204。資料不存在也回 204 |

驗證：`id` 必須是 UUID 格式；`type` 只能是 expense/income；`title` 1–100 字；`category` 1–20 字；`amount` 為正整數；`date` 為合法日期；`note` 最多 255 字；`invoiceId` 必須是 null 或自己的發票 id。

### 4.3 Invoices

Invoice 物件：
```json
{
  "id": "uuid",
  "number": "AB12345678",
  "date": "2026-10-18",
  "period": "11509",
  "amount": 120,
  "seller": "好食光便當",
  "sellerId": "12345678",
  "randomCode": "1234",
  "items": [{ "name": "便當", "qty": 1, "price": 120 }],
  "source": "qr",
  "prizeStatus": "pending",
  "prizeName": null,
  "prizeAmount": 0,
  "checkedAt": null,
  "createdAt": "...",
  "updatedAt": "..."
}
```

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| GET | `/api/invoices` | `{ "invoices": [...] }`，依 date 新到舊。可選 `?period=11509` |
| PUT | `/api/invoices/<id>` | upsert，回 `{ "invoice": ... }`（201 或 200） |
| DELETE | `/api/invoices/<id>` | 204；同時把連到這張發票的 transaction 的 invoice_id 設為 null |

- `number` 收到時先去掉空白和 `-` 再轉大寫，然後驗證 `^[A-Z]{2}\d{8}$`。
- `period`、`prizeStatus`、`prizeName`、`prizeAmount`、`checkedAt` 由伺服器決定，輸入的值會被忽略。
- 新建，或 number／date 有改變時：重設對獎結果；如果資料庫已有該期獎號，立刻對獎（中獎就建立通知）。
- `source`：`qr`（左側 QR Code）／`barcode`（一維條碼）／`ocr`（後端文字辨識）／`manual`（手動輸入），由前端帶入、原封存起來，最近登錄清單會顯示對應圖示。

**POST `/api/invoices/ocr`** — 把發票照片交給後端 RapidOCR（`rapidocr_onnxruntime==1.2.3`）辨識印在發票上的文字，QR Code 讀不到時的救濟。需 JWT Bearer，`multipart/form-data` 欄位 `image`（JPEG/PNG/WebP，≤ 8MB）。

200 回：
```json
{
  "result": {
    "number": "FL70604278",
    "date": "2026-10-10",
    "randomCode": "7596",
    "totalAmount": 70,
    "sellerId": "00087966",
    "period": "11509",
    "invoiceType": "electronic",
    "found": true,
    "missing": [],
    "elapsedMs": 2300
  }
}
```
讀不到的欄位是 `null`。錯誤格式統一為 `{ "error": code, "message": "中文說明" }`：`400 validation_error`（沒有圖檔等）、`413`（超過 8MB）、`503 ocr_unavailable`（伺服器沒裝 OCR 套件）、`401`（未登入）。

OCR 會讀錯，所以後端會驗證統編檢查碼、日期是否在期別內，讀不到就留 null，交給前端提示使用者補。

### 4.4 Lottery

**GET `/api/lottery/draws`** → 200
```json
{
  "draws": [
    {
      "period": "11507",
      "label": "115年 07-08月",
      "special": "89996565",
      "grand": "91098182",
      "first": ["54348835", "44991397", "06595111"],
      "extraSixth": [],
      "drawDate": "2026-09-25",
      "fetchedAt": "..."
    }
  ],
  "lastFetchedAt": "...",
  "nextDraw": { "period": "11509", "label": "115年 09-10月", "drawDate": "2026-11-25" }
}
```
`draws` 依 period 新到舊。回應前先呼叫 `ensure_fresh_draws()`。

**POST `/api/lottery/check`** → 對目前使用者的所有發票重新對獎（先 `ensure_fresh_draws()`）
```json
{
  "checked": 12,
  "newWins": [ Invoice, ... ],
  "summary": { "won": 1, "notWon": 8, "pending": 3 }
}
```

### 4.5 Notifications

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| GET | `/api/notifications` | `{ "notifications": [...], "unreadCount": 2 }`，新到舊，最多 50 筆 |
| POST | `/api/notifications/<id>/read` | 204 |
| POST | `/api/notifications/read-all` | 204 |

Notification 物件：`{ "id": 3, "type": "lottery_win", "title": "...", "body": "...", "invoiceId": "uuid", "read": false, "createdAt": "..." }`

### 4.6 其他

- **GET `/api/health`** → `{ "status": "ok" }`
- **CLI `flask --app wsgi lottery-sync`**：強制抓 RSS 並對獎，印出新增了哪些期別。
- 正式環境：設定 `FRONTEND_DIST`（預設 `../frontend/dist`）。資料夾存在時，非 `/api` 的路徑回傳靜態檔，找不到就回 `index.html`（SPA fallback）。

### 4.7 環境變數（`backend/.env.example`）

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `SECRET_KEY` / `JWT_SECRET_KEY` | 開發用固定字串（啟動時印警告） | 正式環境一定要設定 |
| `DATABASE_URL` | `sqlite:///<backend>/instance/receiptwise.db` | |
| `LOTTERY_RSS_URL` | `https://invoice.etax.nat.gov.tw/invoice.xml` | |
| `LOTTERY_REFRESH_HOURS` | `6` | |
| `CORS_ORIGINS` | `http://localhost:5173` | 開發走 proxy 時用不到 |
| `FRONTEND_DIST` | `../frontend/dist` | |

---

## 5. 統一發票對獎規則

比對的是發票號碼的 **8 碼數字**（英文字軌不比對）。

| 獎別 | 條件 | 獎金 |
| --- | --- | --- |
| 特別獎 | 8 碼與特別獎號碼完全相同 | 10,000,000 |
| 特獎 | 8 碼與特獎號碼完全相同 | 2,000,000 |
| 頭獎 | 8 碼與任一組頭獎號碼完全相同 | 200,000 |
| 二獎 | 末 7 碼與任一組頭獎相同 | 40,000 |
| 三獎 | 末 6 碼與任一組頭獎相同 | 10,000 |
| 四獎 | 末 5 碼與任一組頭獎相同 | 4,000 |
| 五獎 | 末 4 碼與任一組頭獎相同 | 1,000 |
| 六獎 | 末 3 碼與任一組頭獎相同 | 200 |
| 增開六獎 | 末 3 碼與任一組增開六獎相同（目前已停辦，RSS 有才比對） | 200 |

一張發票只取最高的獎。只拿發票所屬期別（period）的獎號來比對。

### RSS 格式（`tests/fixtures/invoice.xml` 是真實範本）

```xml
<item>
  <title><![CDATA[115年 07~08月]]></title>
  <link><![CDATA[https://www.etax.nat.gov.tw/etw-main/ETW183W2_11507]]></link>
  <pubDate>Fri, 25 Sep 2026 05:00:33 GMT</pubDate>
  <description><![CDATA[<p>特別獎：89996565</p><p>特獎：91098182</p><p>頭獎：54348835、44991397、06595111</p>]]></description>
</item>
```
- 期別從 title 解析：`115年 07~08月` → `11507`。
- 號碼之間用全形頓號 `、` 分隔，冒號是全形 `：`。解析時也要容忍半形 `:` 和 `,`。
- 如果 description 有 `增開六獎：` 就解析到 extra_sixth。
- 抓取要設 timeout（10 秒）和 User-Agent。失敗時記 log，繼續用資料庫裡的舊資料。

### 對獎流程（`services/lottery.py`）

1. `ensure_fresh_draws(force=False)`：沒有任何獎號，或上次抓取已超過 `LOTTERY_REFRESH_HOURS`，就抓 RSS。把新期別寫入 LotteryDraw，回傳新增的期別。
2. 每個新增的期別：對所有使用者在該期的發票執行對獎。
3. 對獎時，如果發票從「非 won」變成 `won`，就建立 Notification：
   - title：`恭喜中獎！115年 09-10月 六獎`
   - body：`發票 AB-12345678（好食光便當）對中六獎 NT$200，請在領獎期限內兌領。`
4. 同一張發票、同一期不會重複產生通知。

---

## 6. 期別（period）換算

- 民國年 = 西元年 − 1911。
- period 是 5 碼字串：3 碼民國年 + 該期**第一個月（奇數月）**，例如 2026-10-18 → `11509`（115 年 9–10 月）。
- 顯示名稱：`115年 09-10月`。
- 開獎日：該期結束後的下個月 25 日。`11509` → `2026-11-25`；`11511` → `2027-01-25`。
- 領獎期間（前端顯示用，標註「以財政部公告為準」）：開獎次月 6 日起，約 3 個月。

前端 `utils/period.js` 和後端 `app/utils.py` 各有一份實作，行為要一致。

---

## 7. 電子發票條碼格式（前端 `utils/einvoice.js`）

### 左側 QR Code（主要資訊）
前 77 碼是固定長度欄位：

| 位置（0 起算） | 長度 | 內容 |
| --- | --- | --- |
| 0–9 | 10 | 發票字軌號碼，例如 `AB12345678` |
| 10–16 | 7 | 開立日期，民國 `yyyMMdd`，例如 `1151018` |
| 17–20 | 4 | 隨機碼 |
| 21–28 | 8 | 銷售額（未稅），16 進位 |
| 29–36 | 8 | 總計額（含稅），16 進位 → 記帳金額用這個 |
| 37–44 | 8 | 買方統編，沒有買方時是 `00000000` |
| 45–52 | 8 | 賣方統編 |
| 53–76 | 24 | 加密驗證資訊 |

第 77 碼起，用 `:` 分隔：`:<營業人自行使用區 10 碼>:<本 QR 記載的品目筆數>:<交易品目總筆數>:<中文編碼參數>:<品名>:<數量>:<單價>:<品名>:<數量>:<單價>...`

- 中文編碼參數：`0` = Big5、`1` = UTF-8、`2` = Base64（UTF-8）。掃描器讀到的文字如果是 Big5 可能會亂碼，品名只當參考，解析不到不算錯誤。
- 品名可能含有 `:` 以外的任何字；數量和單價可能是小數。

### 右側 QR Code
以 `**` 開頭，後面接續品目：`**<品名>:<數量>:<單價>:...`。不含發票號碼和金額，單獨掃到時要提示使用者改掃左側 QR Code。

### 一維條碼（Code 39，19 碼）
`<年期別 5 碼><字軌號碼 10 碼><隨機碼 4 碼>`，例如 `11510AB123456781234`。
- 年期別是民國年 + 該期**第二個月（偶數月）**：`11510` 代表 115 年 9–10 月 → period `11509`。
- 沒有日期和金額，使用者要自己補填。

---

## 8. 前端狀態管理與離線同步

### localStorage keys（定義在 `src/constants.js`）

| key | 內容 |
| --- | --- |
| `receiptwise-token` | JWT |
| `receiptwise-user` | 目前使用者 JSON（讓重新整理時能立刻顯示名字） |
| `receiptwise-cache-<userId>` | `{ transactions, invoices, savedAt }` |
| `receiptwise-outbox-<userId>` | 待同步操作陣列 |

啟動時刪除舊版展示模式留下的 `cloudledger-*` key。

### Stores

- **auth**：`token`、`user`、`isLoggedIn`；`login()`、`register()`、`fetchMe()`、`logout()`。
- **ledger**：`transactions`、`invoices`、`status`（`idle` / `syncing` / `offline` / `error`）、`pendingCount`、`lastSyncedAt`、`lastError`。
  - `load()`：先讀快取立刻顯示 → `flush()` 送出待同步操作 → 佇列清空後才從伺服器重抓兩個清單（避免蓋掉還沒送出的修改）→ 寫回快取。
  - `saveTransaction(data)`、`deleteTransaction(id)`、`saveInvoice(data)`、`deleteInvoice(id)`：沒有 id 就用 `crypto.randomUUID()` 產生；先更新畫面和快取（樂觀更新），再加入 outbox，然後呼叫 `flush()`。
  - `flush()`：依序送出 outbox。網路錯誤（fetch 失敗）→ 停止、保留佇列、狀態設為 `offline`。4xx 錯誤 → 丟掉這筆操作，記錄錯誤訊息到 `lastError`，最後重抓伺服器資料修正畫面。成功 → 用伺服器回傳的物件更新本機資料（例如發票的 period、prizeStatus）。
  - 監聽 `window` 的 `online` 事件自動 `flush()`；同一時間只能有一個 flush 在跑。
- **lottery**：`draws`、`nextDraw`、`lastCheck`；`fetchDraws()`、`checkNow()`。
- **notifications**：`items`、`unreadCount`；`fetch()`、`markRead(id)`、`markAllRead()`；有新的未讀中獎通知，而且使用者已允許瀏覽器通知時，用 `new Notification()` 顯示。

### api/client.js
- `request(method, path, body?)`，base 是 `/api`，自動帶 Bearer token。
- 成功回 JSON（204 回 null）。
- 伺服器錯誤丟 `ApiError { status, code, message, fields }`；fetch 本身失敗丟 `NetworkError`。
- 收到 401 `unauthorized` 時，清掉登入狀態並導向 `/login`。

---

## 9. 前端頁面

| 路由 | 頁面 | 重點 |
| --- | --- | --- |
| `/login` | 登入／註冊 | 兩個分頁；顯示伺服器回傳的錯誤訊息 |
| `/` | 儀表板 | 月份切換；當月收入、支出、結餘、發票張數；支出分類圓餅圖（金額＋百分比）；近 6／12 個月收支趨勢，標出開銷高峰月份；和上個月比較；最近交易 |
| `/transactions` | 收支 | 新增、編輯、刪除、搜尋、篩選；`?new=1` 直接打開新增視窗 |
| `/invoices` | 發票 | 清單、編輯、刪除；顯示對獎狀態（待開獎／未中獎／中獎＋獎別金額） |
| `/scanner` | 掃描／補登 | 相機掃描（QR＋一維條碼）、拍照或上傳圖片解析、手動輸入；確認後同時建立發票和一筆支出 |
| `/lottery` | 對獎 | 最近幾期獎號、下次開獎日、我的發票對獎結果（依期別分組）、「立即對獎」 |
| `/settings` | 設定 | 帳號資訊、同步狀態與「立即同步」、開啟中獎瀏覽器通知、清除本機快取、登出 |

### 手機版（寬度 ≤ 600px）
- 底部導覽 5 格：總覽、收支、**掃描（中間凸起的主要按鈕）**、發票、對獎。設定從頂部頭像進入。
- 頂部列顯示同步狀態（已同步／同步中／離線，N 筆待同步）和通知鈴鐺。

### 相機與條碼解析注意事項
- 條碼解碼引擎是 `zxing-wasm`（`src/utils/barcodeReader.js` 包裝，讀 QR Code 與 Code 39）。wasm 檔由 Vite 打包輸出、跟著 PWA 預快取（不打 CDN），離線也能掃；瀏覽器支援原生 `BarcodeDetector` 時（Android Chrome）優先用原生偵測，zxing-wasm 當備援。
- 相機（`components/QrScanner.vue`）用 `getUserMedia` 要求 1920×1080 與後鏡頭，畫面以**原始解析度**畫進 canvas 再解碼（電子發票的 QR Code 很密，縮成掃描框的 CSS 尺寸會解不出來）；支援時開啟連續自動對焦與手電筒切換。
- 相機解碼邏輯在 `src/utils/scanSession.js`：讀到左側 QR 立即採用（右側 QR 品目同一個只合併一次）；只讀到右側 QR 時暫存品目（同一個取代、不累加）繼續掃；只讀到一維條碼時給 **1500ms 寬限期**找左側 QR，等不到才用一維條碼（沒有金額、日期用猜的）。
- 拍照・上傳（`src/utils/imageScan.js`）用**原圖解析度**解（最長邊超過 4000 才縮，避免 48MP 照片吃光記憶體），失敗時依序重試：對比加強（第 2／98 百分位灰階拉伸）、裁左右半邊、縮到最長邊 2000。
- 熱感紙的摺痕或捲曲會讓 QR Code 變形，標準解碼器都假設 QR 是平的、讀不出變形的圖，所以要引導使用者先把發票攤平再拍。
- 條碼真的讀不到時（摺痕、反光）改用後端文字辨識（`src/utils/invoiceOcr.js`）：拍照模式解不到左側 QR 就自動送 OCR；相機模式按「讀不到？拍下來辨識文字」截圖送 OCR。圖先縮到最長邊 2400 再上傳；一維條碼與右側 QR 有解到就優先用（條碼比 OCR 可靠），右側 QR 的品目也會一併帶入。結果經 `buildOcrForm` 合併後填表，`source` 記成 `ocr`，並提示沒讀到或推測（日期從期別推）的欄位、聚焦第一個缺的欄位——**OCR 會讀錯，一律要使用者核對後再儲存**。OCR 失敗但同張圖有一維條碼時退回條碼結果。
- 傳統統一發票（收銀機、手開）**沒有條碼**，掃不到是正常的，只能手動補登。
- `getUserMedia` 只能在 HTTPS 或 localhost 使用。手機用區網 IP（http）開啟時，相機掃描無法使用，要改用 `<input type="file" accept="image/*" capture="environment">` 拍照解析。
- 離開頁面時一定要停止相機（停掉所有 track）。

---

## 10. 開發與測試

```bash
# 後端（第一次）
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # macOS/Linux 用 .venv/bin/python
.venv/Scripts/python -m pytest
.venv/Scripts/python -m flask --app wsgi run --port 5000

# 前端
cd frontend
npm install
npm test          # vitest，測 utils
npm run dev       # http://localhost:5173，/api 轉到 127.0.0.1:5000
npm run build
```

時區一律用 `Asia/Taipei`（Windows 需要 `tzdata` 套件，已列在 requirements.txt）。
