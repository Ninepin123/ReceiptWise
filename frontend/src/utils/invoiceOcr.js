// QR Code 讀不到時的後端文字辨識（OCR）流程。
// 純函式 buildOcrForm 負責把 OCR 結果與同張圖解到的條碼合併成表單欄位，可獨立單元測試；
// prepareOcrImage / recognizeInvoiceText 需要 DOM 與 API，只在瀏覽器執行。

import { api } from '../api/client.js'
import { periodRange } from './period.js'

// OCR 前先把圖縮到這個尺寸以內：夠辨識、上傳與辨識都太快一點
const OCR_MAX_DIMENSION = 2400

/**
 * 把圖片縮到最長邊 ≤ 2400（比較小就不放大），輸出 JPEG 品質 0.9 的 Blob。
 */
export async function prepareOcrImage(fileOrBlob) {
  const bitmap = await createImageBitmap(fileOrBlob)
  try {
    const longest = Math.max(bitmap.width, bitmap.height)
    const scale = longest > OCR_MAX_DIMENSION ? OCR_MAX_DIMENSION / longest : 1
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await new Promise((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('圖片轉檔失敗'))), 'image/jpeg', 0.9)
    )
  } finally {
    bitmap.close?.()
  }
}

/**
 * 把發票照片送到後端 OCR（POST /api/invoices/ocr），回傳 result 物件。
 * 失敗會丟 ApiError（4xx/5xx）或 NetworkError，由呼叫端決定怎麼退回。
 */
export async function recognizeInvoiceText(fileOrBlob) {
  const image = await prepareOcrImage(fileOrBlob)
  const formData = new FormData()
  formData.append('image', image, 'receipt.jpg')
  const data = await api.upload('/invoices/ocr', formData)
  return data?.result
}

/** 期別內最合理的一天：今天在期內就用今天，否則用該期最後一天（同 applyBarcode 的猜法）。 */
function guessDateFromPeriod(period, today) {
  const range = periodRange(period)
  return today >= range.start && today <= range.end ? today : range.end
}

/**
 * 把 OCR 結果加上同一張圖解到的一維條碼與右側 QR，合併成表單欄位（純函式）。
 * - number / randomCode：有一維條碼就用條碼的（條碼比 OCR 可靠），否則用 OCR 的
 * - date：OCR 的；沒有就由期別（OCR 或條碼的）推測並列入 guessed；
 *   完全沒有期別用今天並列入 missing
 * - amount：OCR 的 totalAmount 轉字串，沒有列入 missing
 * - items：右側 QR 的品目，沒有就空陣列
 * 回傳 { fields, missing: [中文字段名], guessed: [中文字段名], ok }；
 * ok = 最後有號碼或金額。
 */
export function buildOcrForm({ ocr, barcode = null, rightQr = null, today }) {
  const ocrResult = ocr || {}
  const missing = []
  const guessed = []

  // 條碼比 OCR 可靠：號碼與隨機碼優先用條碼的
  const number = barcode?.number || ocrResult.number || ''
  const randomCode = barcode?.randomCode || ocrResult.randomCode || ''
  if (!number) missing.push('號碼')

  let date = ocrResult.date || null
  if (!date) {
    const period = ocrResult.period || barcode?.period || null
    if (period) {
      date = guessDateFromPeriod(period, today)
      guessed.push('日期')
    } else {
      date = today
      missing.push('日期')
    }
  }

  const amount = ocrResult.totalAmount != null ? String(ocrResult.totalAmount) : ''
  if (!amount) missing.push('金額')

  const fields = {
    number,
    date,
    amount,
    randomCode,
    sellerId: ocrResult.sellerId || '',
    items: rightQr?.items || [],
    source: 'ocr'
  }
  return { fields, missing, guessed, ok: !!(number || amount) }
}
