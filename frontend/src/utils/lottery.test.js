// lottery.js 單元測試：獎金表、比對位數、天數計算與發票分組。
import { describe, it, expect } from 'vitest'
import { PRIZE_TABLE, matchedDigits, daysUntil, groupInvoicesByStatus } from './lottery.js'

describe('PRIZE_TABLE', () => {
  it('特別獎到六獎共 8 個獎別，金額正確', () => {
    expect(PRIZE_TABLE).toHaveLength(8)
    expect(PRIZE_TABLE[0]).toEqual({ name: '特別獎', amount: 10000000, rule: '8 碼與特別獎號碼相同' })
    expect(PRIZE_TABLE.map((p) => p.name)).toEqual([
      '特別獎', '特獎', '頭獎', '二獎', '三獎', '四獎', '五獎', '六獎'
    ])
    expect(PRIZE_TABLE.map((p) => p.amount)).toEqual([
      10000000, 2000000, 200000, 40000, 10000, 4000, 1000, 200
    ])
  })

  it('每個獎別都有規則說明', () => {
    for (const prize of PRIZE_TABLE) {
      expect(prize.rule.length).toBeGreaterThan(0)
    }
  })
})

describe('matchedDigits', () => {
  it('特別獎／特獎／頭獎比對 8 碼', () => {
    expect(matchedDigits('特別獎')).toBe(8)
    expect(matchedDigits('特獎')).toBe(8)
    expect(matchedDigits('頭獎')).toBe(8)
  })

  it('二獎到六獎依序遞減', () => {
    expect(matchedDigits('二獎')).toBe(7)
    expect(matchedDigits('三獎')).toBe(6)
    expect(matchedDigits('四獎')).toBe(5)
    expect(matchedDigits('五獎')).toBe(4)
    expect(matchedDigits('六獎')).toBe(3)
  })

  it('增開六獎 3 碼，其他未知獎別 0', () => {
    expect(matchedDigits('增開六獎')).toBe(3)
    expect(matchedDigits('不知道的獎')).toBe(0)
    expect(matchedDigits(null)).toBe(0)
  })
})

describe('daysUntil', () => {
  it('相差的天數（未來為正）', () => {
    expect(daysUntil('2026-11-25', '2026-10-23')).toBe(33)
    expect(daysUntil('2026-10-23', '2026-10-23')).toBe(0)
    expect(daysUntil('2026-10-01', '2026-10-23')).toBe(-22)
    expect(daysUntil('2027-01-01', '2026-12-31')).toBe(1) // 跨年
  })

  it('跨月與 2 月天數正確', () => {
    expect(daysUntil('2026-03-01', '2026-02-28')).toBe(1) // 2026 非閏年
    expect(daysUntil('2024-03-01', '2024-02-28')).toBe(2) // 2024 閏年
  })
})

describe('groupInvoicesByStatus', () => {
  const invoices = [
    { id: 'a', prizeStatus: 'not_won', prizeAmount: 0 },
    { id: 'b', prizeStatus: 'won', prizeName: '六獎', prizeAmount: 200 },
    { id: 'c', prizeStatus: 'pending', prizeAmount: 0 },
    { id: 'd', prizeStatus: 'won', prizeName: '頭獎', prizeAmount: 200000 },
    { id: 'e', prizeStatus: 'won', prizeName: '特別獎', prizeAmount: 10000000 }
  ]

  it('依狀態分成三組', () => {
    const { won, notWon, pending } = groupInvoicesByStatus(invoices)
    expect(won.map((i) => i.id)).toEqual(['e', 'd', 'b'])
    expect(notWon.map((i) => i.id)).toEqual(['a'])
    expect(pending.map((i) => i.id)).toEqual(['c'])
  })

  it('won 依獎金由大到小', () => {
    const { won } = groupInvoicesByStatus(invoices)
    expect(won[0].prizeAmount).toBe(10000000)
    expect(won[2].prizeAmount).toBe(200)
  })

  it('空陣列與 null 都回傳空分組', () => {
    expect(groupInvoicesByStatus([])).toEqual({ won: [], notWon: [], pending: [] })
    expect(groupInvoicesByStatus(null)).toEqual({ won: [], notWon: [], pending: [] })
  })
})
