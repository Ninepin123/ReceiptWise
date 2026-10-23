// 顯示格式化工具：金額、發票字軌與百分比。

/** 金額格式化為台幣（無小數），與 src/api.js 的 money 一致。 */
export function money(value) {
  return new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 })
    .format(Number(value) || 0)
}

/** 發票字軌加破折號（'AB12345678' → 'AB-12345678'），格式不符就原樣回傳。 */
export function formatInvoiceNumber(value) {
  const str = String(value ?? '')
  return /^[A-Z]{2}\d{8}$/.test(str) ? `${str.slice(0, 2)}-${str.slice(2)}` : str
}

/** 發票字軌正規化：去空白與符號後轉大寫（' ab-1234 5678 ' → 'AB12345678'）。 */
export function normalizeInvoiceNumber(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
}

/** 發票字軌是否有效（正規化後符合 2 大寫英文字母 + 8 位數字）。 */
export function isValidInvoiceNumber(value) {
  return /^[A-Z]{2}\d{8}$/.test(normalizeInvoiceNumber(value))
}

/** 比例轉百分比字串（percent(0.37) → '37%'，可指定小數位數）。 */
export function percent(ratio, digits = 0) {
  const value = Number(ratio) || 0
  return `${(value * 100).toFixed(digits)}%`
}
