// stats.js 單元測試：月份鍵、單月摘要、趨勢、峰值與環比。
import { describe, it, expect } from 'vitest'
import {
  monthKey,
  addMonths,
  monthLabel,
  monthSummary,
  monthlyTrend,
  findPeak,
  compareWithPrevious
} from './stats.js'

// 2026-10 的樣本交易
const october = [
  { id: 1, type: 'expense', title: '便當', category: '餐飲', amount: 120, date: '2026-10-19' },
  { id: 2, type: 'expense', title: '捷運', category: '交通', amount: 500, date: '2026-10-18' },
  { id: 3, type: 'expense', title: '串流', category: '娛樂', amount: 220, date: '2026-10-12' },
  { id: 4, type: 'expense', title: '宵夜', category: '餐飲', amount: 160, date: '2026-10-08' },
  { id: 5, type: 'income', title: '兼職', category: '薪資', amount: 6500, date: '2026-10-15' }
]

describe('monthKey / addMonths / monthLabel', () => {
  it('日期轉月份鍵', () => {
    expect(monthKey('2026-10-18')).toBe('2026-10')
    expect(monthKey('2026-01-01')).toBe('2026-01')
  })

  it('月份加減（含跨年）', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2025-12', 1)).toBe('2026-01')
    expect(addMonths('2026-05', 6)).toBe('2026-11')
    expect(addMonths('2026-05', 0)).toBe('2026-05')
  })

  it('月份鍵轉標籤', () => {
    expect(monthLabel('2026-05')).toBe('5月')
    expect(monthLabel('2026-01')).toBe('1月')
    expect(monthLabel('2026-12')).toBe('12月')
  })
})

describe('monthSummary', () => {
  it('收支淨額、筆數與分類占比', () => {
    // 混入 9 月交易確認有依月份過濾
    const rows = [
      ...october,
      { id: 6, type: 'expense', title: '上月的', category: '餐飲', amount: 999, date: '2026-09-30' }
    ]
    const summary = monthSummary(rows, '2026-10')
    expect(summary.income).toBe(6500)
    expect(summary.expense).toBe(1000)
    expect(summary.balance).toBe(5500)
    expect(summary.count).toBe(5)
    expect(summary.byCategory).toEqual([
      { category: '交通', amount: 500, ratio: 0.5 },
      { category: '餐飲', amount: 280, ratio: 0.28 },
      { category: '娛樂', amount: 220, ratio: 0.22 }
    ])
    const ratioSum = summary.byCategory.reduce((sum, row) => sum + row.ratio, 0)
    expect(ratioSum).toBeCloseTo(1, 10)
  })

  it('沒有支出時 byCategory 是空陣列', () => {
    const summary = monthSummary([{ id: 1, type: 'income', title: '薪水', category: '薪資', amount: 30000, date: '2026-10-05' }], '2026-10')
    expect(summary.byCategory).toEqual([])
    expect(summary.expense).toBe(0)
    expect(summary.balance).toBe(30000)
  })

  it('金額用 Number() 轉換，NaN 的交易整筆忽略', () => {
    const summary = monthSummary(
      [
        { id: 1, type: 'expense', title: '字串金額', category: '餐飲', amount: '150', date: '2026-10-01' },
        { id: 2, type: 'expense', title: '壞金額', category: '交通', amount: 'abc', date: '2026-10-02' },
        { id: 3, type: 'expense', title: '未知類型', category: '餐飲', amount: 100, date: '2026-10-03', type: 'transfer' }
      ],
      '2026-10'
    )
    expect(summary.expense).toBe(150)
    expect(summary.count).toBe(1)
    expect(summary.byCategory).toEqual([{ category: '餐飲', amount: 150, ratio: 1 }])
  })
})

describe('monthlyTrend', () => {
  it('由舊到新共 n 個月，沒資料補 0', () => {
    const rows = [
      { id: 1, type: 'expense', title: '八月支出', category: '餐飲', amount: 300, date: '2026-08-10' },
      { id: 2, type: 'income', title: '八月收入', category: '薪資', amount: 1000, date: '2026-08-01' },
      { id: 3, type: 'expense', title: '十月支出', category: '交通', amount: 200, date: '2026-10-20' }
    ]
    expect(monthlyTrend(rows, '2026-10', 4)).toEqual([
      { month: '2026-07', label: '7月', income: 0, expense: 0 },
      { month: '2026-08', label: '8月', income: 1000, expense: 300 },
      { month: '2026-09', label: '9月', income: 0, expense: 0 },
      { month: '2026-10', label: '10月', income: 0, expense: 200 }
    ])
  })

  it('預設 6 個月且可跨年', () => {
    const trend = monthlyTrend([], '2026-03')
    expect(trend).toHaveLength(6)
    expect(trend[0].month).toBe('2025-10')
    expect(trend[5].month).toBe('2026-03')
  })
})

describe('findPeak', () => {
  const trend = [
    { month: '2026-07', label: '7月', income: 0, expense: 100 },
    { month: '2026-08', label: '8月', income: 1000, expense: 300 },
    { month: '2026-09', label: '9月', income: 0, expense: 200 },
    { month: '2026-10', label: '10月', income: 0, expense: 0 }
  ]

  it('找出峰值月份並計算比平均高的比例', () => {
    // 平均支出 = 600 / 4 = 150，峰值 300 比平均高 (300-150)/150 = 1
    expect(findPeak(trend)).toEqual({ month: '2026-08', label: '8月', amount: 300, vsAverage: 1 })
  })

  it('可指定欄位', () => {
    // 平均收入 = 250，峰值 1000 比平均高 3 倍
    expect(findPeak(trend, 'income')).toEqual({ month: '2026-08', label: '8月', amount: 1000, vsAverage: 3 })
  })

  it('全部是 0 或空陣列時回傳 null', () => {
    const zeroTrend = [
      { month: '2026-07', label: '7月', income: 0, expense: 0 },
      { month: '2026-08', label: '8月', income: 0, expense: 0 }
    ]
    expect(findPeak(zeroTrend)).toBeNull()
    expect(findPeak([])).toBeNull()
  })
})

describe('compareWithPrevious', () => {
  it('與上月比較，change 是變化比例', () => {
    const rows = [
      { id: 1, type: 'expense', title: '九月支出', category: '餐飲', amount: 400, date: '2026-09-10' },
      { id: 2, type: 'income', title: '九月收入', category: '薪資', amount: 500, date: '2026-09-05' },
      { id: 3, type: 'expense', title: '十月支出', category: '交通', amount: 200, date: '2026-10-20' }
    ]
    expect(compareWithPrevious(rows, '2026-10')).toEqual({
      expense: { current: 200, previous: 400, change: -0.5 },
      income: { current: 0, previous: 500, change: -1 }
    })
  })

  it('上月為 0 時 change 為 null', () => {
    const rows = [{ id: 1, type: 'expense', title: '十月支出', category: '餐飲', amount: 200, date: '2026-10-01' }]
    expect(compareWithPrevious(rows, '2026-10')).toEqual({
      expense: { current: 200, previous: 0, change: null },
      income: { current: 0, previous: 0, change: null }
    })
  })
})
