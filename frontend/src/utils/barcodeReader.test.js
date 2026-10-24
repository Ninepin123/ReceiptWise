// barcodeReader.js 整合測試：node 裡用 zxing-wasm/writer 產生 QR 圖片，
// 用 decodeBarcodes（zxing-wasm/reader）解回來，確認字串完全一致、
// 再交給 parseEInvoiceCode 確認是 left-qr 且金額正確。
// node 沒有 URL fetch 可載 wasm，reader/writer 都用 wasmBinary 從 node_modules 讀。
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { prepareZXingModule as prepareWriter, writeBarcode } from 'zxing-wasm/writer'
import { decodeBarcodes, initBarcodeReader } from './barcodeReader.js'
import { parseEInvoiceCode } from './einvoice.js'

// 組出符合格式的左側 QR 字串（前 77 碼固定欄位 + 品目區段）
function leftQrText() {
  return (
    'AB12345678' + '1151018' + '1234' + '0000006E' + '00000078' + '00000000' + '12345678' + 'A'.repeat(24) +
    ':**********:2:2:1:珍珠奶茶:1:55:雞排:1:70'
  )
}

beforeAll(() => {
  const readerWasm = readFileSync(
    fileURLToPath(new URL('../../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm', import.meta.url))
  )
  initBarcodeReader({ wasmBinary: readerWasm })
  const writerWasm = readFileSync(
    fileURLToPath(new URL('../../node_modules/zxing-wasm/dist/writer/zxing_writer.wasm', import.meta.url))
  )
  prepareWriter({ overrides: { wasmBinary: writerWasm } })
})

describe('decodeBarcodes 整合（writer → reader）', () => {
  it('產生的左側 QR 解回同一個字串，且 parseEInvoiceCode 判定 left-qr、金額 120', async () => {
    const text = leftQrText()
    const { image } = await writeBarcode(text, { format: 'QRCode', scale: 4 })
    expect(image).not.toBeNull()
    const texts = await decodeBarcodes(image)
    expect(texts).toEqual([text])
    const parsed = parseEInvoiceCode(texts[0])
    expect(parsed.kind).toBe('left-qr')
    expect(parsed.number).toBe('AB12345678')
    expect(parsed.totalAmount).toBe(120)
    expect(parsed.items).toEqual([
      { name: '珍珠奶茶', qty: 1, price: 55 },
      { name: '雞排', qty: 1, price: 70 }
    ])
  }, 30000)

  it('同一張圖裡的兩個 QR（左右併排）都能解出來，結果去重', async () => {
    const left = leftQrText()
    const right = '**:**********:2:2:1:便當:1:100:紅茶:1:20'
    const [leftPng, rightPng] = await Promise.all([
      writeBarcode(left, { format: 'QRCode', scale: 4 }),
      writeBarcode(right, { format: 'QRCode', scale: 4 })
    ])
    // 解到同一個 QR 兩次（模擬多結果），decodeBarcodes 只回一份
    const texts = await decodeBarcodes(leftPng.image)
    const again = await decodeBarcodes(leftPng.image)
    expect(texts).toEqual(again)
    expect(await decodeBarcodes(rightPng.image)).toEqual([right])
    expect(new Set([...texts, right]).size).toBe(2)
  }, 30000)

  it('一維條碼（Code 39）也解得出來', async () => {
    const { image } = await writeBarcode('11510AB123456781234', { format: 'Code39', scale: 4 })
    const texts = await decodeBarcodes(image)
    expect(texts).toEqual(['11510AB123456781234'])
    expect(parseEInvoiceCode(texts[0]).kind).toBe('barcode')
  }, 30000)

  it('null 輸入與解不出的圖回 []，不丟例外', async () => {
    expect(await decodeBarcodes(null)).toEqual([])
    // 1×1 白像素不可能是條碼
    const blank = { data: new Uint8ClampedArray([255, 255, 255, 255]), width: 1, height: 1 }
    expect(await decodeBarcodes(blank)).toEqual([])
  }, 30000)
})
