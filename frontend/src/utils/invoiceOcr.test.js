// buildOcrForm 純函式測試：OCR 結果與條碼合併、缺欄位與推測欄位的標記。
// prepareOcrImage / recognizeInvoiceText 需要 DOM 與 API，不在單元測試範圍。
import { describe, it, expect } from 'vitest'
import { buildOcrForm } from './invoiceOcr.js'

// 一維條碼解析後的形狀（parseEInvoiceCode 的 barcode 結果，period 已轉成期別字串）
const BARCODE = { kind: 'barcode', number: 'AB12345678', randomCode: '1234', period: '11509' }
const RIGHT_QR = { kind: 'right-qr', items: [{ name: '便當', qty: 1, price: 100 }] }
const TODAY = '2026-10-24'

describe('buildOcrForm：欄位填入', () => {
  it('OCR 全部欄位都有時直接填入，沒有缺漏也沒有推測', () => {
    const built = buildOcrForm({
      ocr: {
        number: 'FL70604278',
        date: '2026-10-10',
        randomCode: '7596',
        totalAmount: 70,
        sellerId: '00087966',
        period: '11509'
      },
      today: TODAY
    })
    expect(built.fields).toEqual({
      number: 'FL70604278',
      date: '2026-10-10',
      amount: '70',
      randomCode: '7596',
      sellerId: '00087966',
      items: [],
      source: 'ocr'
    })
    expect(built.missing).toEqual([])
    expect(built.guessed).toEqual([])
    expect(built.ok).toBe(true)
  })

  it('有一維條碼時，號碼與隨機碼用條碼的（條碼比 OCR 可靠）', () => {
    const built = buildOcrForm({
      ocr: { number: 'FL70604278', randomCode: '7596', date: '2026-10-10', totalAmount: 70 },
      barcode: BARCODE,
      today: TODAY
    })
    expect(built.fields.number).toBe('AB12345678')
    expect(built.fields.randomCode).toBe('1234')
  })

  it('右側 QR 的品目帶進 items', () => {
    const built = buildOcrForm({
      ocr: { number: 'FL70604278', date: '2026-10-10', totalAmount: 120 },
      rightQr: RIGHT_QR,
      today: TODAY
    })
    expect(built.fields.items).toEqual([{ name: '便當', qty: 1, price: 100 }])
  })

  it('totalAmount 是 0 也算有金額（String(0) 是 "0"）', () => {
    const built = buildOcrForm({ ocr: { number: 'FL70604278', date: '2026-10-10', totalAmount: 0 }, today: TODAY })
    expect(built.fields.amount).toBe('0')
    expect(built.missing).not.toContain('金額')
  })
})

describe('buildOcrForm：日期推測與缺漏', () => {
  it('沒有日期但有期別：今天在期內就用今天，日期列入推測', () => {
    // 期別 11509 = 2026-09-01 ~ 2026-10-31，今天 2026-10-24 在期內
    const built = buildOcrForm({ ocr: { number: 'FL70604278', totalAmount: 70, period: '11509' }, today: TODAY })
    expect(built.fields.date).toBe('2026-10-24')
    expect(built.guessed).toEqual(['日期'])
    expect(built.missing).toEqual([])
  })

  it('沒有日期、期別已過期：用該期最後一天', () => {
    // 期別 11505 = 2026-05-01 ~ 2026-06-30，今天 2026-10-24 已過期
    const built = buildOcrForm({ ocr: { number: 'FL70604278', totalAmount: 70, period: '11505' }, today: TODAY })
    expect(built.fields.date).toBe('2026-06-30')
    expect(built.guessed).toEqual(['日期'])
  })

  it('OCR 沒有期別但條碼有：用條碼的期別推測', () => {
    // 條碼期別 11509 = 2026-09-01 ~ 2026-10-31，今天在期內
    const built = buildOcrForm({ ocr: { totalAmount: 70 }, barcode: BARCODE, today: TODAY })
    expect(built.fields.date).toBe('2026-10-24')
    expect(built.guessed).toEqual(['日期'])
  })

  it('完全沒有日期與期別：用今天並列入缺漏', () => {
    const built = buildOcrForm({ ocr: { number: 'FL70604278', totalAmount: 70 }, today: TODAY })
    expect(built.fields.date).toBe(TODAY)
    expect(built.missing).toEqual(['日期'])
    expect(built.guessed).toEqual([])
  })

  it('號碼與金額都沒有時列入缺漏', () => {
    const built = buildOcrForm({ ocr: { date: '2026-10-10', period: '11509' }, today: TODAY })
    expect(built.missing).toEqual(['號碼', '金額'])
    expect(built.ok).toBe(false)
  })
})

describe('buildOcrForm：ok 判斷', () => {
  it('只有號碼也算 ok（金額手動補）', () => {
    const built = buildOcrForm({ ocr: { number: 'FL70604278' }, today: TODAY })
    expect(built.missing).toEqual(['日期', '金額'])
    expect(built.ok).toBe(true)
  })

  it('只有金額也算 ok（號碼手動補）', () => {
    const built = buildOcrForm({ ocr: { totalAmount: 70, date: '2026-10-10' }, today: TODAY })
    expect(built.missing).toEqual(['號碼'])
    expect(built.ok).toBe(true)
  })

  it('號碼與金額都沒有就不 ok（視同辨識失敗）', () => {
    const built = buildOcrForm({ ocr: null, today: TODAY })
    expect(built.ok).toBe(false)
    expect(built.fields.number).toBe('')
    expect(built.fields.amount).toBe('')
  })
})
