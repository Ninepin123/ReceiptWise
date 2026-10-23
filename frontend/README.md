# ReceiptWise 前端（雲帳 CloudLedger）

Vue 3 單頁應用程式，串接 `../backend` 的 Flask REST API。啟動方式與整體說明請看[專案根目錄 README](../README.md)，架構與 API 規格請看 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)。

## 技術棧

- Vue 3（`<script setup>`）、Vue Router 4、Pinia
- Vite 6、vite-plugin-pwa（可安裝到手機桌面、離線開啟）
- Chart.js + vue-chartjs（儀表板圖表）
- html5-qrcode（相機與圖片條碼解析；瀏覽器支援時優先用原生 BarcodeDetector）
- lucide-vue-next（圖示）
- Vitest（單元測試）

## 指令

| 指令 | 說明 |
| --- | --- |
| `npm run dev` | 開發伺服器（port 5173，`/api` 轉到 `127.0.0.1:5000`） |
| `npm test` | 執行單元測試 |
| `npm run build` | 打包到 `dist/`（含 service worker 與 manifest） |
| `npm run preview` | 預覽打包結果（要測 PWA 用這個） |
| `npx pwa-assets-generator` | 由 `public/icon.svg` 重新產生 PWA 圖示 |

## 目錄

```
src/
├── main.js / App.vue / router.js
├── constants.js        # 分類、分類顏色、localStorage key
├── api/client.js       # fetch 包裝（JWT、錯誤格式）
├── stores/
│   ├── auth.js         # 登入狀態
│   ├── ledger.js       # 收支與發票：快取、離線佇列、同步
│   ├── lottery.js      # 獎號與立即對獎
│   └── notifications.js# 中獎通知、瀏覽器系統通知
├── utils/              # 純函式（都有 *.test.js）
│   ├── einvoice.js     # 電子發票左右 QR Code、一維條碼解析
│   ├── imageScan.js    # 從照片找出條碼
│   ├── period.js       # 民國期別、開獎日、領獎期間
│   ├── stats.js        # 月摘要、趨勢、開銷高峰
│   ├── lottery.js      # 獎別表、末幾碼標示
│   ├── format.js       # 金額、發票號碼格式
│   └── uuid.js         # 非 HTTPS 環境也能用的 UUID
├── components/         # SyncStatus、NotificationBell、QrScanner、InvoiceCaptureForm、StatCard
├── views/              # Login、Dashboard、Transactions、Invoices、Scanner、Lottery、Settings
└── styles/             # CSS，入口是 styles/index.css
```

## 資料同步

所有新增、修改、刪除都會先更新畫面並寫入瀏覽器（`receiptwise-cache-<userId>`），同時放進待同步佇列（`receiptwise-outbox-<userId>`），再依序送到伺服器。斷線、伺服器暫時故障或登入過期時，佇列會保留，連線恢復或 30 秒後自動重送。頂部列的同步狀態可以點擊立即同步。
