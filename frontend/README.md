# ReceiptWise 前端（雲帳 CloudLedger）

以台灣電子發票為核心的智慧記帳平台 ReceiptWise 的前端專案，介面名稱為「雲帳 CloudLedger」。

目前為**前端展示版本**：提供收支記帳、電子發票管理、儀表板統計圖表與發票獎號核對等功能。所有資料保存在瀏覽器的 localStorage，尚未連接後端（之後預計接 Flask REST API，見 `src/api.js` 開頭註解）。

## 技術棧

- [Vue 3](https://vuejs.org/)（Composition API，`<script setup>`）
- [Vite 6](https://vite.dev/)（開發伺服器與打包）
- [Pinia](https://pinia.vuejs.org/)（登入狀態管理）
- [Vue Router 4](https://router.vuejs.org/)（路由與登入守衛）
- [Chart.js](https://www.chartjs.org/) + [vue-chartjs](https://vue-chartjs.org/)（儀表板圖表）
- [lucide-vue-next](https://lucide.dev/)（圖示）

## 環境需求

- Node.js 18 以上（Vite 6 的最低版本需求）
- npm（隨 Node.js 安裝）

## 常用指令

都在 `frontend/` 目錄下執行：

| 指令 | 說明 |
| --- | --- |
| `npm install` | 安裝相依套件（產生 `node_modules/`） |
| `npm run dev` | 啟動 Vite 開發伺服器（`--host 0.0.0.0`，固定 port 5173） |
| `npm run build` | 打包正式版本，輸出到 `dist/` |
| `npm run preview` | 本機預覽 `dist/` 的打包結果（Vite preview，預設 port 4173） |

## 頁面一覽

| 路由 | 頁面 | 說明 |
| --- | --- | --- |
| `/login` | 登入 | 前端展示登入；輸入任意非空白帳號與密碼即可 |
| `/` | 總覽儀表板 | 本月收入／支出／結餘與發票張數統計、近六個月收支趨勢圖、支出分類圓餅圖、最近交易 |
| `/transactions` | 收支管理 | 收支的新增、搜尋、篩選（全部／收入／支出）、編輯、刪除 |
| `/invoices` | 電子發票 | 發票的新增、搜尋、編輯、刪除與核對狀態管理 |
| `/scanner` | QR 掃描輔助 | 掃描流程介面與手動輸入發票表單；相機掃描尚未實作 |
| `/lottery` | 發票獎號核對 | 手動輸入當期獎號，與本機發票做末三碼初步比對 |
| `/settings` | 系統設定 | 顯示資料儲存方式與系統資訊、清除示範資料 |

除了 `/login` 以外的頁面都需先登入（`src/router.js` 的全域路由守衛；已登入時開啟 `/login` 會被導向儀表板）。登出按鈕在側邊欄左下角。

## 目錄結構

```
frontend/
├── index.html              # HTML 進入點
├── package.json            # 套件與 scripts
├── package-lock.json
├── vite.config.js          # Vite 設定（dev server 固定 port 5173）
└── src/
    ├── main.js             # 應用程式進入點
    ├── App.vue             # 版面外框（側邊欄、頂部列）
    ├── router.js           # 路由與登入守衛
    ├── api.js              # 資料層（目前使用 localStorage）
    ├── stores/
    │   └── auth.js         # Pinia 登入狀態
    ├── components/
    │   └── StatCard.vue    # 共用統計卡片元件
    ├── views/              # 7 個頁面元件
    │   ├── Login.vue
    │   ├── Dashboard.vue
    │   ├── Transactions.vue
    │   ├── Invoices.vue
    │   ├── Scanner.vue
    │   ├── Lottery.vue
    │   └── Settings.vue
    └── styles/             # CSS，依區塊拆成多個檔案，入口是 styles/index.css
```

## 資料儲存方式

目前沒有後端，所有資料都保存在**目前瀏覽器的 localStorage**：

| localStorage key | 內容 |
| --- | --- |
| `cloudledger-transactions` | 收支紀錄 |
| `cloudledger-invoices` | 電子發票資料 |
| `cloudledger-demo-user` | 目前的示範登入帳號 |

- 第一次開啟時，`src/api.js` 會自動寫入一組示範資料（數筆收支與發票）。
- 可在「系統設定」頁面清除示範資料；清除後重新載入頁面會再次建立初始示範資料。
- 資料只存在於單一瀏覽器，不會跨裝置同步；清除瀏覽器資料或更換裝置後資料即消失。

## 展示模式的限制

- **無真實驗證**：登入不檢查帳號密碼，輸入任意非空白字串即可進入；沒有註冊、忘記密碼等功能。
- **無後端**：尚未連接 Flask REST API，資料不會上傳或同步；`src/api.js` 之後會改為呼叫後端。
- **相機掃描未實作**：QR 掃描頁目前只有介面與手動輸入表單。
- **獎號核對僅初步比對**：只比對發票號碼的末三碼，且比對範圍以示範資料的月份為準，不能作為正式中獎判定。
- **儀表板部分數值為示範資料**：統計月份與趨勢圖前幾個月的歷史數值為寫死的示範數字，僅當月收支由本機資料計算。
