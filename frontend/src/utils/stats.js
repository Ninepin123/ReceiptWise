// 統計計算工具：月摘要、月趨勢、峰值與環比，供儀表板使用。
// 金額一律經 Number() 轉換，轉換後為 NaN 的交易整筆忽略。

/** 日期字串轉月份鍵（'2026-10-18' → '2026-10'）。 */
export function monthKey(dateStr) {
  return String(dateStr).slice(0, 7)
}

/** 月份鍵加減月數（addMonths('2026-01', -1) → '2025-12'，正確處理跨年）。 */
export function addMonths(month, delta) {
  const [year, m] = String(month).split('-').map(Number)
  const total = year * 12 + (m - 1) + Number(delta)
  const newYear = Math.floor(total / 12)
  const newMonth = (total % 12) + 1
  return `${newYear}-${String(newMonth).padStart(2, '0')}`
}

/** 月份鍵轉顯示標籤（'2026-05' → '5月'）。 */
export function monthLabel(month) {
  return `${parseInt(String(month).slice(5, 7), 10)}月`
}

/** 判斷交易的 type 是否為收支之一，並把金額轉成數字（NaN 視為無效）。 */
function amountOf(transaction) {
  if (!transaction) return null
  if (transaction.type !== 'income' && transaction.type !== 'expense') return null
  const amount = Number(transaction.amount)
  return Number.isNaN(amount) ? null : amount
}

/** 單月摘要：收支淨額、筆數與支出分類占比（byCategory 只算支出，依金額由大到小）。 */
export function monthSummary(transactions, month) {
  const rows = (transactions ?? []).filter(
    (t) => amountOf(t) !== null && monthKey(t.date) === month
  )
  let income = 0
  let expense = 0
  const byCategoryMap = new Map()
  for (const t of rows) {
    const amount = amountOf(t)
    if (t.type === 'income') {
      income += amount
    } else {
      expense += amount
      byCategoryMap.set(t.category, (byCategoryMap.get(t.category) ?? 0) + amount)
    }
  }
  const byCategory = [...byCategoryMap.entries()]
    .map(([category, amount]) => ({
      category,
      amount,
      ratio: expense > 0 ? amount / expense : 0
    }))
    .sort((a, b) => b.amount - a.amount)
  return { income, expense, balance: income - expense, count: rows.length, byCategory }
}

/** 最近 n 個月的收支趨勢（由舊到新，沒資料的月份補 0）。 */
export function monthlyTrend(transactions, endMonth, n = 6) {
  const months = Math.max(0, Number(n) || 0)
  const trend = []
  for (let i = months - 1; i >= 0; i--) {
    const month = addMonths(endMonth, -i)
    const summary = monthSummary(transactions, month)
    trend.push({
      month,
      label: monthLabel(month),
      income: summary.income,
      expense: summary.expense
    })
  }
  return trend
}

/** 找出趨勢中的峰值月份，回傳 { month, label, amount, vsAverage }；全部為 0 時回傳 null。 */
export function findPeak(trend, field = 'expense') {
  const rows = trend ?? []
  if (rows.length === 0) return null
  const total = rows.reduce((sum, row) => sum + (Number(row[field]) || 0), 0)
  if (total <= 0) return null
  const average = total / rows.length
  let peak = null
  for (const row of rows) {
    const amount = Number(row[field]) || 0
    if (!peak || amount > peak.amount) {
      peak = { month: row.month, label: row.label, amount }
    }
  }
  return { ...peak, vsAverage: (peak.amount - average) / average }
}

/** 與上月比較：回傳支出與收入的 { current, previous, change }，上月為 0 時 change 為 null。 */
export function compareWithPrevious(transactions, month) {
  const current = monthSummary(transactions, month)
  const previous = monthSummary(transactions, addMonths(month, -1))
  const calc = (cur, prev) => ({
    current: cur,
    previous: prev,
    change: prev === 0 ? null : (cur - prev) / prev
  })
  return {
    expense: calc(current.expense, previous.expense),
    income: calc(current.income, previous.income)
  }
}
