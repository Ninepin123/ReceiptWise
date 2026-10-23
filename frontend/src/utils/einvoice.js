// 電子發票字軌解析：左側 QR、右側 QR 與一維條碼。
// 格式參考 docs/ARCHITECTURE.md 第 7 節。

import { periodOf, periodFromBarcode, fromRocYear } from './period.js'

// 左側 QR 前 53 碼的固定欄位（字軌10 + 民國日期7 + 隨機碼4 + 銷售額8 + 總計8 + 買賣家統編各8），
// 後 24 碼為加密資訊，不驗證內容。
const LEFT_QR_PREFIX = /^[A-Z]{2}\d{8}\d{7}\d{4}[0-9A-Fa-f]{8}[0-9A-Fa-f]{8}\d{8}\d{8}$/
// 一維條碼：年期別5（民國年3 + 偶數月2）+ 字軌2 + 序號8 + 隨機碼4
const BARCODE = /^\d{5}[A-Z]{2}\d{8}\d{4}$/

/** 取得某年某月的天數（UTC 計算，2 月與閏年皆正確）。 */
function lastDayOf(adYear, month) {
  return new Date(Date.UTC(adYear, month, 0)).getUTCDate()
}

/** 民國日期 yyyMMdd 轉西元 YYYY-MM-DD，月日不合法回傳 null。 */
function rocDateToAd(yyyMMdd) {
  const adYear = fromRocYear(parseInt(yyyMMdd.slice(0, 3), 10))
  const month = parseInt(yyyMMdd.slice(3, 5), 10)
  const day = parseInt(yyyMMdd.slice(5, 7), 10)
  const pad = (n) => String(n).padStart(2, '0')
  if (month < 1 || month > 12) return null
  if (day < 1 || day > lastDayOf(adYear, month)) return null
  return `${adYear}-${pad(month)}-${pad(day)}`
}

/** 嘗試把 Base64 字串解成 UTF-8 文字，失敗就保留原字串。 */
function tryDecodeBase64(name) {
  try {
    const binary = atob(name)
    return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
  } catch {
    return name
  }
}

/**
 * 解析「:自行使用區:本碼品目數:總品目數:編碼參數:品名:數量:單價…」品目區段。
 * 每 3 個一組，最後不完整或數字轉換失敗的那組丟掉。
 */
function parseItemSection(rest) {
  if (!rest) return { encoding: null, items: [] }
  const parts = rest.split(':')
  if (parts[0] === '') parts.shift() // 開頭的 ':' 分割出的空字串
  const encoding = parts.length >= 4 ? Number(parts[3]) : null
  const fields = parts.slice(4)
  const items = []
  for (let i = 0; i + 2 < fields.length; i += 3) {
    const name = fields[i]
    const qty = Number(fields[i + 1])
    const price = Number(fields[i + 2])
    if (Number.isNaN(qty) || Number.isNaN(price)) continue
    items.push({ name, qty, price })
  }
  if (encoding === 2) {
    for (const item of items) item.name = tryDecodeBase64(item.name)
  }
  return { encoding, items }
}

/**
 * 解析電子發票字軌（左側 QR / 右側 QR / 一維條碼），
 * 無法辨識時回傳 { kind: 'unknown', raw, reason }。
 */
export function parseEInvoiceCode(input) {
  const raw = String(input ?? '').trim()
  if (raw === '') return { kind: 'unknown', raw, reason: '空字串' }

  // 左側 QR：長度 >= 77，前 53 碼符合固定欄位格式
  if (raw.length >= 77 && LEFT_QR_PREFIX.test(raw.slice(0, 53))) {
    const number = raw.slice(0, 10)
    const date = rocDateToAd(raw.slice(10, 17))
    if (!date) return { kind: 'unknown', raw, reason: '發票日期不合法' }
    const randomCode = raw.slice(17, 21)
    const salesAmount = parseInt(raw.slice(21, 29), 16)
    const totalAmount = parseInt(raw.slice(29, 37), 16)
    const buyerId = raw.slice(37, 45) === '00000000' ? null : raw.slice(37, 45)
    const sellerId = raw.slice(45, 53)
    const { encoding, items } = parseItemSection(raw.slice(77))
    return {
      kind: 'left-qr',
      number,
      date,
      randomCode,
      salesAmount,
      totalAmount,
      buyerId,
      sellerId,
      period: periodOf(date),
      items,
      encoding,
      raw
    }
  }

  // 右側 QR：以 ** 開頭，其後依同樣規則解析品目
  if (raw.startsWith('**')) {
    // 規格：右側 QR 是「**」接著左側未記載的品目（品名:數量:單價…），沒有表頭；
    // 若遇到重複表頭（10 碼自行使用區:筆數:筆數:編碼）的實作也相容
    let body = raw.slice(2)
    if (body.startsWith(':')) body = body.slice(1)
    if (/^.{10}:\d+:\d+:[0-2]:/.test(body)) {
      return { kind: 'right-qr', items: parseItemSection(':' + body).items, raw }
    }
    return { kind: 'right-qr', items: parseItemSection(':x:0:0:1:' + body).items, raw }
  }

  // 一維條碼：19 碼，年期別需為 02–12 的偶數月
  if (BARCODE.test(raw)) {
    const period = periodFromBarcode(raw.slice(0, 5))
    if (!period) return { kind: 'unknown', raw, reason: '條碼月份不是合法期別' }
    return {
      kind: 'barcode',
      number: raw.slice(5, 15),
      randomCode: raw.slice(15, 19),
      period,
      raw
    }
  }

  return { kind: 'unknown', raw, reason: '無法辨識的格式' }
}

/** 把右側 QR 的品目接到左側結果後面，回傳新物件（不修改原物件）。 */
export function mergeItems(leftResult, rightResult) {
  const leftItems = Array.isArray(leftResult?.items) ? leftResult.items : []
  const rightItems = Array.isArray(rightResult?.items) ? rightResult.items : []
  return { ...leftResult, items: [...leftItems, ...rightItems] }
}
