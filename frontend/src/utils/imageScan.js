// 圖片解析：用 BarcodeDetector 或 html5-qrcode 的 scanFile 解出圖片中的條碼文字。
// 純函式（classifyScanTexts / nextRegion / SCAN_REGIONS）不碰 DOM，可獨立單元測試。

import { parseEInvoiceCode } from './einvoice.js'

/**
 * 把多筆解碼文字分類：左側 QR / 右側 QR / 一維條碼各取第一個成功的結果。
 * 重複文字與無法辨識的文字不重複處理（unknown 收集起來僅供除錯）。
 */
export function classifyScanTexts(texts) {
  const result = { leftQr: null, rightQr: null, barcode: null, unknown: [] }
  const seen = new Set()
  for (const item of texts || []) {
    const text = String(item ?? '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    const parsed = parseEInvoiceCode(text)
    if (parsed.kind === 'left-qr' && !result.leftQr) result.leftQr = parsed
    else if (parsed.kind === 'right-qr' && !result.rightQr) result.rightQr = parsed
    else if (parsed.kind === 'barcode' && !result.barcode) result.barcode = parsed
    else result.unknown.push(parsed)
  }
  return result
}

// ---- 掃描區域規劃（純函式） ----
// 左右並排兩個 QR Code 的整張圖（電子發票證明聯的典型版面），
// zxing 的 QR 偵測器看到兩組定位點常常兩個都解不出來，
// 所以照順序裁不同水平區域重試。null 代表整張圖、垂直方向一律保留整張高度。
export const SCAN_REGIONS = [
  null, // 整張圖
  [0, 0.6], // 左側（QR 約在 0–58%）
  [0, 0.55],
  [0, 0.5],
  [0, 0.7],
  [0.5, 1], // 右側
  [0.4, 1],
  [0.55, 1]
]

// 總嘗試次數上限（含整張圖與各裁切區域）
export const MAX_SCAN_ATTEMPTS = 8

/**
 * 依狀態挑下一個要嘗試的區域。state = { index, hasLeft, hasRight }：
 * - index：下一個考慮的區域編號（呼叫端試完後設成回傳的 index + 1）
 * - hasLeft / hasRight：是否已解到左側／右側 QR
 * 已解到左側 QR 就跳過左側區域（只補右側）、已解到右側 QR 就跳過右側區域；
 * 兩邊都有或區域用完回傳 null（結束）。
 * 回傳 { index, region }，region 為 null 表示整張圖。
 */
export function nextRegion(state) {
  if (state?.hasLeft && state?.hasRight) return null // 左右都拿到了，結束
  const start = Number.isInteger(state?.index) ? Math.max(0, state.index) : 0
  for (let i = start; i < SCAN_REGIONS.length; i++) {
    const region = SCAN_REGIONS[i]
    if (region === null) return { index: i, region: null }
    const isRight = region[1] === 1
    if (isRight ? state.hasRight : state.hasLeft) continue
    return { index: i, region }
  }
  return null
}

// ---- DOM 相關部分 ----

// html5-qrcode 的 scanFile 需要一個掛在 document 上的元素（會把圖片縮放畫進去再解碼）。
// 不能用 display: none（clientWidth 會是 0，圖片被縮到 300px 寬導致解不出來），
// 改放到畫面外並給大一點的尺寸，讓圖片保留足夠解析度。
let fileScanElementId = null

function ensureFileScanElement() {
  if (!fileScanElementId) {
    fileScanElementId = `rw-file-scan-${Math.random().toString(36).slice(2, 10)}`
    const el = document.createElement('div')
    el.id = fileScanElementId
    el.setAttribute('aria-hidden', 'true')
    Object.assign(el.style, {
      position: 'fixed',
      left: '-99999px',
      top: '0',
      width: '2000px',
      height: '2000px',
      overflow: 'hidden',
      pointerEvents: 'none'
    })
    document.body.appendChild(el)
  }
  return fileScanElementId
}

// 掃一張圖，回傳解到的文字；失敗丟例外
async function scanFileOnce(file) {
  // 動態載入：純 node 測試環境不會拉進 html5-qrcode
  const { Html5Qrcode } = await import('html5-qrcode')
  const scanner = new Html5Qrcode(ensureFileScanElement(), { verbose: false })
  try {
    return await scanner.scanFile(file, false)
  } finally {
    try {
      await scanner.clear()
    } catch {
      // 沒渲染過就 clear 會丟例外，忽略
    }
  }
}

// 用原生 BarcodeDetector 一次偵測圖片中所有條碼（不支援就回 []）
async function detectWithBarcodeDetector(file) {
  if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return []
  try {
    const detector = new window.BarcodeDetector({ formats: ['qr_code', 'code_39'] })
    const bitmap = await createImageBitmap(file)
    try {
      const codes = await detector.detect(bitmap)
      return codes.map((c) => c.rawValue).filter(Boolean)
    } finally {
      bitmap.close?.()
    }
  } catch {
    // 格式不支援或偵測失敗，改用 html5-qrcode
    return []
  }
}

// 大圖（手機照片常見 4000px 寬）等比例縮到最長邊 1600px 再處理；小圖不放大
const MAX_IMAGE_DIMENSION = 1600

async function downscaleIfNeeded(file) {
  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file // 讀不出尺寸就用原檔
  }
  try {
    const longest = Math.max(bitmap.width, bitmap.height)
    if (longest <= MAX_IMAGE_DIMENSION) return file
    const scale = MAX_IMAGE_DIMENSION / longest
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('圖片轉檔失敗'))), 'image/jpeg', 0.92)
    )
    return new File([blob], 'receipt-small.jpg', { type: 'image/jpeg' })
  } finally {
    bitmap.close?.()
  }
}

// 只裁水平方向 [x0, x1]（0–1），垂直保留整張高度，轉成新 File
async function cropRegion(file, x0, x1) {
  const bitmap = await createImageBitmap(file)
  try {
    const sx = Math.max(0, Math.min(1, x0))
    const ex = Math.max(sx + 1 / bitmap.width, Math.min(1, x1)) // 至少留 1px 寬
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * (ex - sx)))
    canvas.height = bitmap.height
    canvas.getContext('2d').drawImage(
      bitmap,
      Math.round(bitmap.width * sx),
      0,
      canvas.width,
      bitmap.height,
      0,
      0,
      canvas.width,
      canvas.height
    )
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('圖片轉檔失敗'))), 'image/png')
    )
    return new File([blob], 'receipt-crop.png', { type: 'image/png' })
  } finally {
    bitmap.close?.()
  }
}

// html5-qrcode 的 scanFile 一次只回一個結果，照 nextRegion 的計畫逐區域嘗試。
// hasRightAlready：BarcodeDetector 已解到右側 QR 時就不再試右側區域。
async function detectWithScanFile(file, hasRightAlready = false) {
  const work = await downscaleIfNeeded(file)
  const texts = []
  const seen = new Set()
  const state = { index: 0, hasLeft: false, hasRight: hasRightAlready }
  let attempts = 0
  while (attempts < MAX_SCAN_ATTEMPTS) {
    const next = nextRegion(state)
    if (!next) break
    state.index = next.index + 1
    attempts++
    let target = work
    if (next.region) {
      try {
        target = await cropRegion(work, next.region[0], next.region[1])
      } catch {
        continue // 裁切失敗，試下一個區域
      }
    }
    let text = ''
    try {
      text = await scanFileOnce(target)
    } catch {
      continue // 這個區域解不出來
    }
    if (!text || seen.has(text)) continue
    seen.add(text)
    texts.push(text)
    const kind = parseEInvoiceCode(text).kind
    if (kind === 'left-qr') state.hasLeft = true
    else if (kind === 'right-qr') state.hasRight = true
    // 解到一維條碼也保留在 texts（左側 QR 資訊比較完整，不因此停止）
  }
  return texts
}

/**
 * 掃描圖片檔，回傳解出的所有不重複條碼文字（一張發票通常能拿到左右兩個 QR）。
 * 1. 支援原生 BarcodeDetector 時一次偵測所有條碼；解到左側 QR 就直接回傳
 * 2. 否則照 SCAN_REGIONS 逐區域用 html5-qrcode scanFile 重試（先整張、再左側、再右側）
 * 3. 都失敗回 []
 */
export async function scanImageFile(file) {
  const detected = await detectWithBarcodeDetector(file)
  const found = classifyScanTexts(detected)
  if (found.leftQr) return detected // 左 QR 已拿到，資訊最完整
  const fromRegions = await detectWithScanFile(file, found.rightQr != null)
  return [...detected, ...fromRegions.filter((t) => !detected.includes(t))]
}
