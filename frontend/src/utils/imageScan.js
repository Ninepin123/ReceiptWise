// 圖片解析：拍照・上傳的發票照片用 zxing-wasm 解出條碼文字。
// 重點：用原圖解析度解（不要先縮圖，那是之前解不出來的主因），
// 再用對比加強、左右裁切與縮圖重試補足光線不均的照片。
// 純函式（classifyScanTexts / planImageAttempts / contrastStretch / cropImageData /
// resizeImageData）不碰 DOM，可獨立單元測試。

import { parseEInvoiceCode } from './einvoice.js'
import { decodeBarcodes } from './barcodeReader.js'

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

// ---- 嘗試計畫（純函式） ----
// 解碼步驟代號：
// - native：原生 BarcodeDetector（Android Chrome 又快又準）
// - full：zxing-wasm 解原圖
// - contrast：zxing-wasm 解對比加強後的灰階圖
// - crop-left / crop-right：對比加強後的圖裁左（0–0.6）／右（0.4–1）半邊再解
// - small：縮到最長邊 2000 再解（模糊的大照片有時反而比較好解）
// 左右並排兩個 QR Code 的整張圖，zxing 看到兩組定位點常常兩個都解不出來，
// 所以裁半邊重試；已解到的那一側就不用再裁。

/**
 * 依狀態排出要依序嘗試的步驟清單。
 * state = { hasLeft, hasRight, longestSide, hasNative }：
 * - hasLeft：已解到左側 QR → 沒有要做的事（呼叫端也會停）
 * - hasRight：已解到右側 QR → 跳過 crop-right
 * - longestSide：原圖最長邊（> 2400 才排 small）
 * - hasNative：有原生 BarcodeDetector 可用
 */
export function planImageAttempts({ hasLeft = false, hasRight = false, longestSide = 0, hasNative = false } = {}) {
  if (hasLeft) return []
  const steps = []
  if (hasNative) steps.push('native')
  steps.push('full', 'contrast')
  if (!hasLeft) steps.push('crop-left')
  if (!hasRight) steps.push('crop-right')
  if (longestSide > 2400) steps.push('small')
  return steps
}

// ---- 像素處理（純函式，輸入輸出都是 { data, width, height }） ----

/**
 * 灰階 + 對比拉伸：算出每像素亮度後，把第 2 與第 98 百分位線性拉伸到 0–255。
 * 熱感紙偏灰、光線不均的照片拉伸後黑白對比變清楚，QR Code 比較解得出來。
 */
export function contrastStretch(imageData) {
  const { data, width, height } = imageData
  const pixels = width * height
  const histogram = new Array(256).fill(0)
  const luminance = new Uint8ClampedArray(pixels)
  for (let i = 0; i < pixels; i++) {
    const p = i * 4
    const y = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000
    luminance[i] = y
    histogram[luminance[i]]++
  }
  const percentile = (ratio) => {
    let acc = 0
    const target = pixels * ratio
    for (let value = 0; value < 256; value++) {
      acc += histogram[value]
      if (acc >= target) return value
    }
    return 255
  }
  const low = percentile(0.02)
  const high = percentile(0.98)
  const out = new Uint8ClampedArray(pixels * 4)
  const scale = high > low ? 255 / (high - low) : 0
  for (let i = 0; i < pixels; i++) {
    // low==high 表示整張圖亮度幾乎一致，拉伸無意義，保留原值
    const y = scale ? (luminance[i] - low) * scale : luminance[i]
    const p = i * 4
    out[p] = out[p + 1] = out[p + 2] = y
    out[p + 3] = 255 // 不透明，避免 alpha 影響解碼
  }
  return { data: out, width, height }
}

/**
 * 只裁水平方向 [x0, x1]（0–1），垂直保留整張高度。
 */
export function cropImageData(imageData, x0, x1) {
  const { data, width, height } = imageData
  const sx = Math.max(0, Math.min(1, x0))
  const ex = Math.max(sx + 1 / width, Math.min(1, x1)) // 至少留 1px 寬
  const outWidth = Math.max(1, Math.round(width * (ex - sx)))
  const startX = Math.round(width * sx)
  const out = new Uint8ClampedArray(outWidth * height * 4)
  for (let row = 0; row < height; row++) {
    const from = (row * width + startX) * 4
    out.set(data.subarray(from, from + outWidth * 4), row * outWidth * 4)
  }
  return { data: out, width: outWidth, height }
}

/**
 * 面積平均（box filter）等比例縮小到最長邊 maxLongest；不需要縮時回傳原物件。
 */
export function resizeImageData(imageData, maxLongest) {
  const { data, width, height } = imageData
  const longest = Math.max(width, height)
  if (longest <= maxLongest) return imageData
  const scale = maxLongest / longest
  const outWidth = Math.max(1, Math.round(width * scale))
  const outHeight = Math.max(1, Math.round(height * scale))
  const out = new Uint8ClampedArray(outWidth * outHeight * 4)
  for (let dy = 0; dy < outHeight; dy++) {
    const sy0 = (dy * height) / outHeight
    const sy1 = ((dy + 1) * height) / outHeight
    for (let dx = 0; dx < outWidth; dx++) {
      const sx0 = (dx * width) / outWidth
      const sx1 = ((dx + 1) * width) / outWidth
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let area = 0
      for (let sy = Math.floor(sy0); sy < Math.ceil(sy1) && sy < height; sy++) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0)
        if (wy <= 0) continue
        for (let sx = Math.floor(sx0); sx < Math.ceil(sx1) && sx < width; sx++) {
          const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0)
          if (wx <= 0) continue
          const weight = wx * wy
          const p = (sy * width + sx) * 4
          r += data[p] * weight
          g += data[p + 1] * weight
          b += data[p + 2] * weight
          a += data[p + 3] * weight
          area += weight
        }
      }
      const q = (dy * outWidth + dx) * 4
      const inv = area > 0 ? 1 / area : 0
      out[q] = r * inv
      out[q + 1] = g * inv
      out[q + 2] = b * inv
      out[q + 3] = a * inv
    }
  }
  return { data: out, width: outWidth, height: outHeight }
}

// ---- DOM 相關部分（掃描圖檔的進入點） ----

// 48MP 級手機照片直接解會吃光記憶體，超過才縮；否則一律用原圖解析度
const MAX_NATIVE_DIMENSION = 4000

function bitmapToImageData(bitmap, maxLongest = MAX_NATIVE_DIMENSION) {
  const longest = Math.max(bitmap.width, bitmap.height)
  const scale = longest > maxLongest ? maxLongest / longest : 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

// 用原生 BarcodeDetector 一次偵測圖片中所有條碼（不支援就回 []）
async function detectWithBarcodeDetector(bitmap) {
  if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return []
  try {
    const detector = new window.BarcodeDetector({ formats: ['qr_code', 'code_39'] })
    const codes = await detector.detect(bitmap)
    return codes.map((c) => c.rawValue).filter(Boolean)
  } catch {
    // 格式不支援或偵測失敗，改用 zxing-wasm
    return []
  }
}

/**
 * 掃描圖片檔，回傳解出的所有不重複條碼文字（一張發票通常能拿到左右兩個 QR）。
 * 照 planImageAttempts 的計畫依序嘗試，一拿到左側 QR（資訊最完整）就停，
 * 其餘結果都收集起來；全部失敗回 []。
 */
export async function scanImageFile(file) {
  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch (err) {
    console.warn('圖片讀取失敗', err)
    return []
  }
  try {
    const hasNative = typeof window !== 'undefined' && 'BarcodeDetector' in window
    const longestSide = Math.max(bitmap.width, bitmap.height)
    let base = null // 原圖（或 >4000 時縮過的版本）
    let contrast = null // 對比加強版，用到才算（裁切步驟共用）
    const texts = []
    const seen = new Set()
    let hasLeft = false
    let hasRight = false
    const done = new Set()

    for (;;) {
      // 每解完一步就重排計畫：已拿到右側 QR 就跳過右側裁切等規則都在純函式裡
      const steps = planImageAttempts({ hasLeft, hasRight, longestSide, hasNative })
      const step = steps.find((s) => !done.has(s))
      if (!step) break
      done.add(step)

      let results = []
      if (step === 'native') results = await detectWithBarcodeDetector(bitmap)
      else if (step === 'full') {
        base = base || bitmapToImageData(bitmap)
        results = await decodeBarcodes(base)
      } else if (step === 'contrast') {
        base = base || bitmapToImageData(bitmap)
        contrast = contrast || contrastStretch(base)
        results = await decodeBarcodes(contrast)
      } else if (step === 'crop-left' || step === 'crop-right') {
        contrast = contrast || contrastStretch(base || bitmapToImageData(bitmap))
        const region = step === 'crop-left' ? [0, 0.6] : [0.4, 1]
        results = await decodeBarcodes(cropImageData(contrast, region[0], region[1]))
      } else if (step === 'small') {
        base = base || bitmapToImageData(bitmap)
        results = await decodeBarcodes(resizeImageData(base, 2000))
      }

      for (const text of results) {
        if (!text || seen.has(text)) continue
        seen.add(text)
        texts.push(text)
      }
      const found = classifyScanTexts(texts)
      hasLeft = !!found.leftQr
      hasRight = !!found.rightQr
      if (hasLeft) break // 左側 QR 一次補齊號碼、日期、金額與品目
    }
    return texts
  } finally {
    bitmap.close?.()
  }
}
