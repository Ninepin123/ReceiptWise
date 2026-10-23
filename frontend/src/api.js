// 前端示範資料層：使用 localStorage，暫不連接 Flask API。
const KEYS = { transactions: 'cloudledger-transactions', invoices: 'cloudledger-invoices' }

const initialTransactions = [
  {
    id: 1,
    type: 'expense',
    title: '午餐便當',
    category: '餐飲',
    amount: 120,
    date: '2026-10-19',
    note: '公司附近'
  },
  {
    id: 2,
    type: 'expense',
    title: '捷運加值',
    category: '交通',
    amount: 500,
    date: '2026-10-18',
    note: ''
  },
  {
    id: 3,
    type: 'income',
    title: '兼職收入',
    category: '薪資',
    amount: 6500,
    date: '2026-10-15',
    note: ''
  },
  {
    id: 4,
    type: 'expense',
    title: '串流訂閱',
    category: '娛樂',
    amount: 220,
    date: '2026-10-12',
    note: ''
  },
  {
    id: 5,
    type: 'expense',
    title: '生活用品',
    category: '購物',
    amount: 780,
    date: '2026-10-08',
    note: ''
  },
  {
    id: 6,
    type: 'income',
    title: '專案款項',
    category: '其他收入',
    amount: 3000,
    date: '2026-09-27',
    note: ''
  }
]
const initialInvoices = [
  {
    id: 1,
    number: 'AB-12345678',
    date: '2026-10-18',
    amount: 120,
    seller: '好食光便當',
    status: '待核對',
    randomCode: '1234'
  },
  {
    id: 2,
    number: 'CD-87654321',
    date: '2026-10-12',
    amount: 220,
    seller: '數位娛樂服務',
    status: '待核對',
    randomCode: '5678'
  }
]
function read(key, seed) {
  try {
    const value = localStorage.getItem(key)
    if (value) return JSON.parse(value)
    localStorage.setItem(key, JSON.stringify(seed))
    return [...seed]
  } catch {
    return [...seed]
  }
}
function save(key, rows) {
  localStorage.setItem(key, JSON.stringify(rows))
  return rows
}
export const getTransactions = () => read(KEYS.transactions, initialTransactions)
export const saveTransactions = (rows) => save(KEYS.transactions, rows)
export const getInvoices = () => read(KEYS.invoices, initialInvoices)
export const saveInvoices = (rows) => save(KEYS.invoices, rows)
export const money = (value) =>
  new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 })
    .format(Number(value) || 0)
