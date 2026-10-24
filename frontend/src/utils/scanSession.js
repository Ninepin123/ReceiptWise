// 相機掃描的階段邏輯（純狀態機，不含 DOM 也不自己計時）：
// 決定每個解碼結果要採用、暫存還是等待，Scanner.vue 負責執行動作與 setTimeout。
// 一維條碼只有號碼（金額要手補、日期用猜的），所以讀到後先給 1500ms 寬限期，
// 看能不能等到資訊完整的左側 QR；等不到才用一維條碼。

import { parseEInvoiceCode } from './einvoice.js'

// 讀到一維條碼後，等左側 QR 的寬限期
export const BARCODE_GRACE_MS = 1500

/**
 * 建立掃描階段狀態：
 * - pendingRightQr：最後讀到的右側 QR { raw, items }（同一個就取代，不累加）
 * - mergedRightQrRaw：已合併進表單的右側 QR 原始文字（同一個只合併一次）
 * - pendingBarcode：寬限期中的一維條碼 parsed
 * - barcodeSeenAt：一維條碼第一次讀到的時間（寬限期從這裡起算，不順延）
 */
export function createScanSession() {
  return {
    pendingRightQr: null,
    mergedRightQrRaw: null,
    pendingBarcode: null,
    barcodeSeenAt: 0
  }
}

/**
 * 處理一張畫面解到的文字陣列，回傳要依序執行的動作清單：
 * - { action: 'apply-left', parsed, rightItems } 採用左側 QR 並停相機；
 *   rightItems = 同畫面與先前暫存、尚未合併過的右側品目
 * - { action: 'merge-right', parsed } 右側 QR，表單已有左側資料 → 品目合併進表單
 * - { action: 'store-right', parsed } 右側 QR，表單沒有左側資料 → 暫存，繼續掃
 * - { action: 'barcode-grace', parsed, deadline } 讀到一維條碼，進入寬限期
 * - { action: 'apply-barcode', parsed } 一維條碼直接採用（immediateBarcode 時）
 * - { action: 'unrecognized' } 只有無法辨識的文字，短暫提示就好
 * hasLeftData：表單目前是否已有左側 QR 填入的資料（source === 'qr'）。
 * immediateBarcode：拍照模式只有一張畫面，沒有寬限期可等左側 QR，
 * 一維條碼直接採用，也不留 pendingBarcode 狀態（重複上傳同一張不會被狀態卡住）。
 */
export function handleScanTexts(state, texts, now, { hasLeftData = false, immediateBarcode = false } = {}) {
  const actions = []
  let left = null
  let right = null
  let barcode = null
  let hasUnknown = false
  const seen = new Set()
  for (const item of texts || []) {
    const parsed = parseEInvoiceCode(item)
    if (parsed.kind === 'unknown') {
      hasUnknown = true
      continue
    }
    if (seen.has(parsed.raw)) continue
    seen.add(parsed.raw)
    if (parsed.kind === 'left-qr' && !left) left = parsed
    else if (parsed.kind === 'right-qr' && !right) right = parsed
    else if (parsed.kind === 'barcode' && !barcode) barcode = parsed
  }

  // 左側 QR：號碼、日期、金額、品目一次補齊，馬上採用
  if (left) {
    const rightItems = []
    // 同畫面與先前暫存的右側品目都合併（同一個原始文字只合併一次）
    for (const candidate of [right, state.pendingRightQr]) {
      if (!candidate || candidate.raw === state.mergedRightQrRaw) continue
      rightItems.push(...(candidate.items || []))
      state.mergedRightQrRaw = candidate.raw
    }
    state.pendingRightQr = null
    state.pendingBarcode = null // 改用左側 QR，寬限中的一維條碼作廢
    actions.push({ action: 'apply-left', parsed: left, rightItems })
    return actions
  }

  if (right) {
    state.pendingRightQr = right // 同一個右側 QR 就取代，不會累加好幾份品目
    if (hasLeftData) {
      if (right.raw !== state.mergedRightQrRaw) {
        state.mergedRightQrRaw = right.raw
        actions.push({ action: 'merge-right', parsed: right })
      }
      return actions
    }
    actions.push({ action: 'store-right', parsed: right })
  }

  if (barcode) {
    if (immediateBarcode) {
      actions.push({ action: 'apply-barcode', parsed: barcode })
    } else if (!state.pendingBarcode) {
      state.pendingBarcode = barcode
      state.barcodeSeenAt = now
      actions.push({ action: 'barcode-grace', parsed: barcode, deadline: now + BARCODE_GRACE_MS })
    } else if (state.pendingBarcode.raw !== barcode.raw) {
      state.pendingBarcode = barcode // 換成新條碼，但寬限期不重新起算
    }
  }

  if (hasUnknown && actions.length === 0) actions.push({ action: 'unrecognized' })
  return actions
}

/**
 * 寬限期到點檢查（Scanner.vue 用 setTimeout 呼叫）：
 * 等不到左側 QR 就回傳 { action: 'apply-barcode', parsed } 採用一維條碼；
 * 沒有等待中的條碼或時間還沒到回傳 null。
 */
export function scanTick(state, now) {
  if (state.pendingBarcode && now - state.barcodeSeenAt >= BARCODE_GRACE_MS) {
    const parsed = state.pendingBarcode
    state.pendingBarcode = null
    return { action: 'apply-barcode', parsed }
  }
  return null
}
