// 對獎頁用的小工具：獎金表、獎別比對位數、天數計算與發票分組。

/** 獎金表（增開六獎目前停辦，不列；規則見 ARCHITECTURE.md 第 5 節） */
export const PRIZE_TABLE = [
  { name: '特別獎', amount: 10000000, rule: '8 碼與特別獎號碼相同' },
  { name: '特獎', amount: 2000000, rule: '8 碼與特獎號碼相同' },
  { name: '頭獎', amount: 200000, rule: '8 碼與任一組頭獎號碼相同' },
  { name: '二獎', amount: 40000, rule: '末 7 碼與任一組頭獎相同' },
  { name: '三獎', amount: 10000, rule: '末 6 碼與任一組頭獎相同' },
  { name: '四獎', amount: 4000, rule: '末 5 碼與任一組頭獎相同' },
  { name: '五獎', amount: 1000, rule: '末 4 碼與任一組頭獎相同' },
  { name: '六獎', amount: 200, rule: '末 3 碼與任一組頭獎相同' }
]

// 各獎別比對發票號碼的末幾碼
const MATCHED_DIGITS = {
  特別獎: 8,
  特獎: 8,
  頭獎: 8,
  二獎: 7,
  三獎: 6,
  四獎: 5,
  五獎: 4,
  六獎: 3,
  增開六獎: 3
}

/** 各獎別要比對發票號碼的末幾碼（'六獎' → 3），未知獎別回傳 0。 */
export function matchedDigits(prizeName) {
  return MATCHED_DIGITS[prizeName] ?? 0
}

/** 兩個 YYYY-MM-DD 相差幾天（dateStr − today，用 UTC 計算避免時區差）。 */
export function daysUntil(dateStr, today) {
  const toUtc = (s) => {
    const [y, m, d] = String(s).split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((toUtc(dateStr) - toUtc(today)) / 86400000)
}

/** 依對獎狀態分組 { won, notWon, pending }，won 依獎金由大到小。 */
export function groupInvoicesByStatus(invoices) {
  const won = []
  const notWon = []
  const pending = []
  for (const inv of invoices ?? []) {
    if (inv.prizeStatus === 'won') won.push(inv)
    else if (inv.prizeStatus === 'pending') pending.push(inv)
    else notWon.push(inv)
  }
  won.sort((a, b) => (b.prizeAmount ?? 0) - (a.prizeAmount ?? 0))
  return { won, notWon, pending }
}
