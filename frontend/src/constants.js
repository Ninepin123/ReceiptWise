// 全域常數：收支分類、分類顏色與 localStorage key。

/** 支出分類清單 */
export const EXPENSE_CATEGORIES = ['餐飲', '交通', '娛樂', '購物', '居家', '醫療', '教育', '其他']

/** 收入分類清單 */
export const INCOME_CATEGORIES = ['薪資', '獎金', '投資', '其他收入']

/** 分類對應的固定顏色（紫色 #6558e8 為主色，其餘色系以好辨識為原則） */
export const CATEGORY_COLORS = {
  '餐飲': '#6558e8',
  '交通': '#62c5b4',
  '娛樂': '#f3a76b',
  '購物': '#e58bb4',
  '居家': '#8d83f2',
  '醫療': '#e2574c',
  '教育': '#f2c94c',
  '其他': '#8f9bb3',
  '薪資': '#3d9970',
  '獎金': '#bd10e0',
  '投資': '#b3adfa',
  '其他收入': '#4a90d9'
}

/** localStorage 的 key（cache / outbox 依使用者區分） */
export const STORAGE_KEYS = {
  token: 'receiptwise-token',
  user: 'receiptwise-user',
  cache: (userId) => `receiptwise-cache-${userId}`,
  outbox: (userId) => `receiptwise-outbox-${userId}`
}

/** 舊版 CloudLedger 的 localStorage key 前綴（供 migration 用） */
export const LEGACY_STORAGE_PREFIX = 'cloudledger-'

/** 查詢分類顏色，查不到時回傳灰色。 */
export function categoryColor(name) {
  return CATEGORY_COLORS[name] ?? '#9e9e9e'
}
