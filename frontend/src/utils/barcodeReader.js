// zxing-wasm 包裝：解 QR Code 與 Code 39（一維條碼）。
// wasm 檔由打包器輸出、跟著 PWA 預快取走，不打 CDN（離線可用）。

import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

// overrides 是整個覆蓋（不是合併），要自己帶 locateFile 把 wasm 指到打包結果
function browserOverrides() {
  return {
    locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasmUrl : prefix + path)
  }
}

let customOverrides = null
let prepared = false

/**
 * 覆寫 zxing-wasm 初始化參數。node 測試環境沒有 fetch/URL 可載 wasm，
 * 改用 fs.readFileSync 讀 wasm 後以 { wasmBinary } 傳入。
 */
export function initBarcodeReader(overrides) {
  customOverrides = overrides || null
  prepared = false
}

function ensurePrepared() {
  if (prepared) return
  prepareZXingModule({ overrides: customOverrides || browserOverrides() })
  prepared = true
}

// 一張發票有左 QR、右 QR 與一維條碼，多留一格餘裕
const READER_OPTIONS = {
  formats: ['QRCode', 'Code39'],
  tryHarder: true,
  tryRotate: true,
  maxNumberOfSymbols: 4
}

/**
 * 解出輸入（Blob 或 { data, width, height }）中的條碼文字。
 * 回傳去重、trim 過且 isValid 的文字陣列；解不到回 []，不丟例外。
 */
export async function decodeBarcodes(input) {
  if (!input) return []
  ensurePrepared()
  try {
    const results = await readBarcodes(input, READER_OPTIONS)
    const seen = new Set()
    const texts = []
    for (const result of results || []) {
      if (!result?.isValid) continue
      const text = String(result.text ?? '').trim()
      if (!text || seen.has(text)) continue
      seen.add(text)
      texts.push(text)
    }
    return texts
  } catch (err) {
    // 解碼失敗不算錯誤流程（換下一張畫面／下一種前處理重試），記一下就好
    console.warn('zxing-wasm 解碼失敗', err)
    return []
  }
}
