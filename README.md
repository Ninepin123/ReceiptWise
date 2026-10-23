# ReceiptWise
以台灣電子發票為核心的智慧記帳平台
功能說明
- **收支 CRUD**：新增、列表、搜尋、編輯、刪除。
- **儀表板**：當月支出、收入、結餘、支出分類圓餅圖、最近六個月趨勢與近期紀錄。
- **電子發票**：新增、列表、搜尋、編輯、刪除；發票號碼格式為兩碼英文字母加八碼數字。
- **QR 掃描**：使用 `html5-qrcode`。瀏覽器相機一般要求 localhost 或 HTTPS 並取得權限。不同發票 QR payload 格式不一，現有解析是輔助辨識，不保證完整解析所有雙 QR Code 內容，請核對欄位。
- **統一發票對獎**：使用者手動輸入的獎號。
- **資料位置**：

## 專案結構

目前 repository 內只有前端專案，後端尚未加入：

```
ReceiptWise/
├── README.md          # 本檔案
└── frontend/          # Vue 3 前端專案（Vite + Pinia + Vue Router）
```

前端目前為展示模式：登入不做真實驗證，收支與發票資料皆保存在瀏覽器的 localStorage，尚未連接後端 API。

## 快速開始

需先安裝 Node.js 18 以上版本。

```bash
cd frontend
npm install
npm run dev
```

開發伺服器固定使用 5173 port，啟動後以瀏覽器開啟 http://localhost:5173 即可看到登入頁（輸入任意非空白帳號與密碼即可進入）。

更詳細的說明（技術棧、指令、頁面一覽、資料儲存方式）請見 [frontend/README.md](frontend/README.md)。
