// einvoice.js 單元測試：左側 QR、右側 QR、一維條碼與品目合併。
import { describe, it, expect } from 'vitest'
import { parseEInvoiceCode, mergeItems } from './einvoice.js'

/** 組出符合格式的左側 QR 字串（前 77 碼 + 可選品目區段）。 */
function leftQr(opts = {}) {
  const {
    number = 'AB12345678',
    rocDate = '1151018', // 民國 115 年 10 月 18 日
    randomCode = '1234',
    sales = '0000006E', // 0x6E = 110
    total = '00000078', // 0x78 = 120
    buyer = '00000000',
    seller = '12345678',
    tail = 'A'.repeat(24), // 24 碼加密資訊
    extra = ''
  } = opts
  return number + rocDate + randomCode + sales + total + buyer + seller + tail + extra
}

describe('parseEInvoiceCode：左側 QR', () => {
  it('完整左側 QR（含品目）', () => {
    const text = leftQr({ extra: ':**********:2:2:1:便當:1:100:紅茶:1:20' })
    expect(parseEInvoiceCode(text)).toEqual({
      kind: 'left-qr',
      number: 'AB12345678',
      date: '2026-10-18',
      randomCode: '1234',
      salesAmount: 110,
      totalAmount: 120,
      buyerId: null,
      sellerId: '12345678',
      period: '11509',
      items: [
        { name: '便當', qty: 1, price: 100 },
        { name: '紅茶', qty: 1, price: 20 }
      ],
      encoding: 1,
      raw: text
    })
  })

  it('剛好 77 碼、沒有品目的左側 QR', () => {
    const result = parseEInvoiceCode(leftQr())
    expect(result.kind).toBe('left-qr')
    expect(result.items).toEqual([])
    expect(result.encoding).toBeNull()
    expect(result.period).toBe('11509')
  })

  it('有買方統編時 buyerId 保留原值', () => {
    const result = parseEInvoiceCode(leftQr({ buyer: '12345675' }))
    expect(result.buyerId).toBe('12345675')
  })

  it('金額 hex 支援小寫', () => {
    const result = parseEInvoiceCode(leftQr({ sales: '0000006e' }))
    expect(result.salesAmount).toBe(110)
  })

  it('品目支援小數數量與單價', () => {
    const result = parseEInvoiceCode(leftQr({ extra: ':**********:1:1:1:咖啡:1.5:99.9' }))
    expect(result.items).toEqual([{ name: '咖啡', qty: 1.5, price: 99.9 }])
  })

  it('日期月日不合法回傳 unknown', () => {
    expect(parseEInvoiceCode(leftQr({ rocDate: '1151332' })).kind).toBe('unknown') // 13 月
    expect(parseEInvoiceCode(leftQr({ rocDate: '1150231' })).kind).toBe('unknown') // 2 月 31 日
    expect(parseEInvoiceCode(leftQr({ rocDate: '1151000' })).kind).toBe('unknown') // 0 日
    expect(parseEInvoiceCode(leftQr({ rocDate: '1150229' })).kind).toBe('unknown') // 2026 非閏年
    expect(parseEInvoiceCode(leftQr({ rocDate: '1130229' })).period).toBe('11301') // 2024 閏年合法
  })

  it('最後不完整的一組品目會被丟掉', () => {
    const result = parseEInvoiceCode(leftQr({ extra: ':**********:2:2:1:便當:1:100:紅茶' }))
    expect(result.items).toEqual([{ name: '便當', qty: 1, price: 100 }])
  })

  it('數字轉換失敗的品目會被丟掉', () => {
    const result = parseEInvoiceCode(leftQr({ extra: ':**********:2:2:1:便當:abc:100:紅茶:1:xyz' }))
    expect(result.items).toEqual([])
  })

  it('編碼參數 2 時品名嘗試 Base64 → UTF-8 解碼', () => {
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode('拿鐵')))
    const decoded = parseEInvoiceCode(leftQr({ extra: `:**********:1:1:2:${b64}:1:60` }))
    expect(decoded.items).toEqual([{ name: '拿鐵', qty: 1, price: 60 }])
    // 解不開就保留原字串
    const kept = parseEInvoiceCode(leftQr({ extra: ':**********:1:1:2:###:1:60' }))
    expect(kept.items).toEqual([{ name: '###', qty: 1, price: 60 }])
  })
})

describe('parseEInvoiceCode：右側 QR', () => {
  it('以 ** 開頭，依同樣規則解析品目', () => {
    const result = parseEInvoiceCode('**:**********:1:1:1:咖啡:2:60')
    expect(result.kind).toBe('right-qr')
    expect(result.items).toEqual([{ name: '咖啡', qty: 2, price: 60 }])
  })

  it('多筆品目與不完整品目', () => {
    const result = parseEInvoiceCode('**:**********:2:2:1:便當:1:100:紅茶:1:20:可樂')
    expect(result.items).toEqual([
      { name: '便當', qty: 1, price: 100 },
      { name: '紅茶', qty: 1, price: 20 }
    ])
  })

  it('只有 ** 時品目為空陣列', () => {
    expect(parseEInvoiceCode('**')).toEqual({ kind: 'right-qr', items: [], raw: '**' })
  })
})

describe('parseEInvoiceCode：一維條碼', () => {
  it('19 碼一維條碼', () => {
    const result = parseEInvoiceCode('11510AB123456781234')
    expect(result).toEqual({
      kind: 'barcode',
      number: 'AB12345678',
      randomCode: '1234',
      period: '11509',
      raw: '11510AB123456781234'
    })
    expect(parseEInvoiceCode('11602AB123456781234').period).toBe('11601')
  })

  it('年期別不是 02–12 的偶數月回傳 unknown', () => {
    expect(parseEInvoiceCode('11511AB123456781234').kind).toBe('unknown')
    expect(parseEInvoiceCode('11500AB123456781234').kind).toBe('unknown')
    expect(parseEInvoiceCode('11513AB123456781234').kind).toBe('unknown')
  })
})

describe('parseEInvoiceCode：邊界情況', () => {
  it('空字串與只有空白回傳 unknown', () => {
    const result = parseEInvoiceCode('   ')
    expect(result.kind).toBe('unknown')
    expect(result.raw).toBe('')
  })

  it('亂碼回傳 unknown 並附中文原因', () => {
    const result = parseEInvoiceCode('hello world')
    expect(result.kind).toBe('unknown')
    expect(typeof result.reason).toBe('string')
    expect(result.reason.length).toBeGreaterThan(0)
  })

  it('前後空白會被 trim', () => {
    const result = parseEInvoiceCode('  11510AB123456781234  ')
    expect(result.kind).toBe('barcode')
    expect(result.raw).toBe('11510AB123456781234')
  })
})

describe('mergeItems', () => {
  it('把右側品目接到左側結果後面且不修改原物件', () => {
    const left = parseEInvoiceCode(leftQr({ extra: ':**********:1:1:1:便當:1:100' }))
    const right = parseEInvoiceCode('**:**********:2:2:1:咖啡:2:60:紅茶:1:20')
    const merged = mergeItems(left, right)
    expect(merged.items).toEqual([
      { name: '便當', qty: 1, price: 100 },
      { name: '咖啡', qty: 2, price: 60 },
      { name: '紅茶', qty: 1, price: 20 }
    ])
    // 原物件不被修改
    expect(left.items).toHaveLength(1)
    expect(right.items).toHaveLength(2)
    expect(merged).not.toBe(left)
    expect(merged.number).toBe('AB12345678')
  })
})

describe('parseEInvoiceCode：右側 QR 沒有表頭（規格格式）', () => {
  it('** 直接接品目', () => {
    expect(parseEInvoiceCode('**可樂:1:72:洋芋片:2:35').items).toEqual([
      { name: '可樂', qty: 1, price: 72 },
      { name: '洋芋片', qty: 2, price: 35 }
    ])
  })

  it('** 後面先接冒號', () => {
    expect(parseEInvoiceCode('**:可樂:1:72').items).toEqual([{ name: '可樂', qty: 1, price: 72 }])
  })
})
