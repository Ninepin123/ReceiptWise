// 電子發票「期別」換算工具（統一發票每兩個月為一期：01-02、03-04、…、11-12）。
// 日期一律用字串或 UTC 計算，避免時區差造成差一天。

/** 取得台北時區今天的日期字串（YYYY-MM-DD）。 */
export function todayInTaipei() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
}

/** 西元年轉民國年（2026 → 115）。 */
export function toRocYear(adYear) {
  return Number(adYear) - 1911
}

/** 民國年轉西元年（115 → 2026）。 */
export function fromRocYear(rocYear) {
  return Number(rocYear) + 1911
}

/** 取得某月的天數（用 UTC 計算，2 月與閏年皆正確）。 */
function lastDayOf(adYear, month) {
  return new Date(Date.UTC(adYear, month, 0)).getUTCDate()
}

/** 把民國年與期別起始月組成五位期別字串（如 115、9 → '11509'）。 */
function toPeriod(rocYear, startMonth) {
  return `${String(rocYear).padStart(3, '0')}${String(startMonth).padStart(2, '0')}`
}

/** 西元日期字串（YYYY-MM-DD）轉期別字串（'2026-10-18' → '11509'）。 */
export function periodOf(dateStr) {
  const [adYear, adMonth] = String(dateStr).split('-').map(Number)
  const startMonth = adMonth - ((adMonth - 1) % 2) // 1→1、2→1、9→9、10→9、11→11、12→11
  return toPeriod(toRocYear(adYear), startMonth)
}

/** 期別轉顯示標籤（'11509' → '115年 09-10月'）。 */
export function periodLabel(period) {
  const rocYear = parseInt(period.slice(0, 3), 10)
  const startMonth = parseInt(period.slice(3, 5), 10)
  const endMonth = startMonth + 1
  const pad = (m) => String(m).padStart(2, '0')
  return `${rocYear}年 ${pad(startMonth)}-${pad(endMonth)}月`
}

/** 期別轉西元日期範圍（'11509' → { start: '2026-09-01', end: '2026-10-31' }）。 */
export function periodRange(period) {
  const adYear = fromRocYear(period.slice(0, 3))
  const startMonth = parseInt(period.slice(3, 5), 10)
  const endMonth = startMonth + 1
  const pad = (m) => String(m).padStart(2, '0')
  return {
    start: `${adYear}-${pad(startMonth)}-01`,
    end: `${adYear}-${pad(endMonth)}-${String(lastDayOf(adYear, endMonth)).padStart(2, '0')}`
  }
}

/** 期別的開獎日：期別結束月的次月 25 日（'11509' → '2026-11-25'）。 */
export function drawDate(period) {
  const adYear = fromRocYear(period.slice(0, 3))
  const endMonth = parseInt(period.slice(3, 5), 10) + 1
  // 次月：12 月結束的期別會跨年到隔年 1 月
  const drawYear = adYear + Math.floor(endMonth / 12)
  const drawMonth = (endMonth % 12) + 1
  return `${drawYear}-${String(drawMonth).padStart(2, '0')}-25`
}

/** 對獎領獎期間：開獎次月 6 日起至 3 個月後的 5 日（'11509' → 2026-12-06 ~ 2027-03-05）。 */
export function claimWindow(period) {
  const [drawYear, drawMonth] = drawDate(period).split('-').map(Number)
  const pad = (m) => String(m).padStart(2, '0')
  // 起始 = 開獎次月 6 日（以 0 起算的月份做加減，正確處理跨年）
  const startTotal = drawMonth // drawMonth - 1 + 1（次月）
  const startY = drawYear + Math.floor(startTotal / 12)
  const startM = (startTotal % 12) + 1
  // 結束 = 起始再往後 3 個月的 5 日
  const endTotal = startTotal + 3
  const endY = drawYear + Math.floor(endTotal / 12)
  const endM = (endTotal % 12) + 1
  return {
    start: `${startY}-${pad(startM)}-06`,
    end: `${endY}-${pad(endM)}-05`
  }
}

/** 今天所屬的期別（可傳入日期字串覆寫「今天」）。 */
export function currentPeriod(today = todayInTaipei()) {
  return periodOf(today)
}

/** 上一期（'11501' → '11411'，正確處理跨年）。 */
export function previousPeriod(period) {
  const rocYear = parseInt(period.slice(0, 3), 10)
  const startMonth = parseInt(period.slice(3, 5), 10)
  if (startMonth === 1) return toPeriod(rocYear - 1, 11)
  return toPeriod(rocYear, startMonth - 2)
}

/** 下一期（'11511' → '11601'，正確處理跨年）。 */
export function nextPeriod(period) {
  const rocYear = parseInt(period.slice(0, 3), 10)
  const startMonth = parseInt(period.slice(3, 5), 10)
  if (startMonth === 11) return toPeriod(rocYear + 1, 1)
  return toPeriod(rocYear, startMonth + 2)
}

/** 開獎日 >= today 的最早一期（today '2026-11-26' → '11511'）。 */
export function nextDrawPeriod(today) {
  // 從上一期開始往後找：上一期的開獎日可能正好是今天（當天仍可對獎）
  let period = previousPeriod(periodOf(today))
  while (drawDate(period) < today) period = nextPeriod(period)
  return period
}

/** 一維條碼年期別（偶數月）轉期別起始月（'11510' → '11509'），非 02–12 的偶數月回傳 null。 */
export function periodFromBarcode(code5) {
  if (!/^\d{5}$/.test(code5)) return null
  const rocYear = code5.slice(0, 3)
  const month = parseInt(code5.slice(3, 5), 10)
  if (month < 2 || month > 12 || month % 2 !== 0) return null
  return toPeriod(rocYear, month - 1)
}
