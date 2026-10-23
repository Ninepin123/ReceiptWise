// format.js 單元測試：金額、發票字軌與百分比格式化。
import { describe, it, expect } from 'vitest'
import {
  money,
  formatInvoiceNumber,
  normalizeInvoiceNumber,
  isValidInvoiceNumber,
  percent
} from './format.js'

describe('money', () => {
  it('格式化為台幣（無小數、千分位）', () => {
    // 貨幣符號隨 ICU/CLDR 版本不同（舊版 NT$、CLDR 45+ 為 $），只驗證數字格式
    expect(money(120)).toMatch(/^(NT)?\$120$/)
    expect(money(1234567)).toMatch(/^(NT)?\$1,234,567$/)
    expect(money('150')).toMatch(/^(NT)?\$150$/)
    expect(money(1234.6)).toMatch(/^(NT)?\$1,235$/) // maximumFractionDigits: 0 會四捨五入
  })

  it('無效值回傳與 0 相同的格式（此環境 ICU 顯示 $0）', () => {
    expect(money(NaN)).toBe(money(0))
    expect(money(null)).toBe(money(0))
    expect(money('abc')).toBe(money(0))
  })
})

describe('formatInvoiceNumber', () => {
  it('字軌加上破折號', () => {
    expect(formatInvoiceNumber('AB12345678')).toBe('AB-12345678')
  })

  it('格式不符就原樣回傳', () => {
    expect(formatInvoiceNumber('AB-12345678')).toBe('AB-12345678')
    expect(formatInvoiceNumber('ab12345678')).toBe('ab12345678')
    expect(formatInvoiceNumber('AB1234567')).toBe('AB1234567')
  })
})

describe('normalizeInvoiceNumber', () => {
  it('去空白與符號後轉大寫', () => {
    expect(normalizeInvoiceNumber(' ab-1234 5678 ')).toBe('AB12345678')
    expect(normalizeInvoiceNumber('ab12345678')).toBe('AB12345678')
    expect(normalizeInvoiceNumber('AB/1234-5678')).toBe('AB12345678')
  })
})

describe('isValidInvoiceNumber', () => {
  it('正規化後符合 2 英文字母 + 8 位數字', () => {
    expect(isValidInvoiceNumber('AB12345678')).toBe(true)
    expect(isValidInvoiceNumber('ab-1234 5678')).toBe(true)
    expect(isValidInvoiceNumber('AB1234567')).toBe(false) // 少一位
    expect(isValidInvoiceNumber('A12345678')).toBe(false) // 只有一個字母
    expect(isValidInvoiceNumber('')).toBe(false)
    expect(isValidInvoiceNumber(null)).toBe(false)
  })
})

describe('percent', () => {
  it('比例轉百分比字串', () => {
    expect(percent(0.37)).toBe('37%')
    expect(percent(0.5)).toBe('50%')
    expect(percent(1)).toBe('100%')
    expect(percent(-0.1)).toBe('-10%')
  })

  it('可指定小數位數', () => {
    expect(percent(0.375, 1)).toBe('37.5%')
    expect(percent(1 / 3, 1)).toBe('33.3%')
    expect(percent(0.123456, 2)).toBe('12.35%')
  })
})
