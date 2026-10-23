// period.js 單元測試：期別換算、開獎日、對獎期間與台北時區今天。
import { describe, it, expect } from 'vitest'
import {
  toRocYear,
  fromRocYear,
  periodOf,
  periodLabel,
  periodRange,
  drawDate,
  claimWindow,
  currentPeriod,
  previousPeriod,
  nextPeriod,
  nextDrawPeriod,
  todayInTaipei,
  periodFromBarcode
} from './period.js'

describe('toRocYear / fromRocYear', () => {
  it('西元與民國互轉', () => {
    expect(toRocYear(2026)).toBe(115)
    expect(toRocYear(1911)).toBe(0)
    expect(fromRocYear(115)).toBe(2026)
    expect(fromRocYear(0)).toBe(1911)
  })
})

describe('periodOf', () => {
  it('把西元日期換成所屬期別', () => {
    expect(periodOf('2026-10-18')).toBe('11509')
    expect(periodOf('2026-01-05')).toBe('11501')
    expect(periodOf('2026-12-31')).toBe('11511')
    expect(periodOf('2026-09-01')).toBe('11509')
    expect(periodOf('2026-02-28')).toBe('11501')
    expect(periodOf('2026-11-30')).toBe('11511')
  })
})

describe('periodLabel', () => {
  it('產生人類可讀的期別標籤', () => {
    expect(periodLabel('11509')).toBe('115年 09-10月')
    expect(periodLabel('11501')).toBe('115年 01-02月')
    expect(periodLabel('11511')).toBe('115年 11-12月')
  })
})

describe('periodRange', () => {
  it('換成西元日期範圍', () => {
    expect(periodRange('11509')).toEqual({ start: '2026-09-01', end: '2026-10-31' })
  })

  it('2 月月底與閏年正確', () => {
    expect(periodRange('11501')).toEqual({ start: '2026-01-01', end: '2026-02-28' })
    expect(periodRange('11301')).toEqual({ start: '2024-01-01', end: '2024-02-29' }) // 2024 閏年
    expect(periodRange('11303')).toEqual({ start: '2024-03-01', end: '2024-04-30' })
  })

  it('11-12 月期別', () => {
    expect(periodRange('11511')).toEqual({ start: '2026-11-01', end: '2026-12-31' })
  })
})

describe('drawDate', () => {
  it('開獎日是期別結束月的次月 25 日', () => {
    expect(drawDate('11509')).toBe('2026-11-25')
    expect(drawDate('11511')).toBe('2027-01-25') // 跨年
    expect(drawDate('11501')).toBe('2026-03-25')
  })
})

describe('claimWindow', () => {
  it('開獎次月 6 日起至 3 個月後的 5 日', () => {
    expect(claimWindow('11509')).toEqual({ start: '2026-12-06', end: '2027-03-05' })
    expect(claimWindow('11511')).toEqual({ start: '2027-02-06', end: '2027-05-05' })
    expect(claimWindow('11501')).toEqual({ start: '2026-04-06', end: '2026-07-05' })
  })
})

describe('currentPeriod / previousPeriod / nextPeriod', () => {
  it('今天所屬期別', () => {
    expect(currentPeriod('2026-10-23')).toBe('11509')
    expect(currentPeriod('2026-01-01')).toBe('11501')
  })

  it('上一期（含跨年）', () => {
    expect(previousPeriod('11509')).toBe('11507')
    expect(previousPeriod('11501')).toBe('11411')
  })

  it('下一期（含跨年）', () => {
    expect(nextPeriod('11509')).toBe('11511')
    expect(nextPeriod('11511')).toBe('11601')
  })
})

describe('nextDrawPeriod', () => {
  it('開獎日 >= today 的最早一期', () => {
    expect(nextDrawPeriod('2026-10-23')).toBe('11509')
    expect(nextDrawPeriod('2026-11-26')).toBe('11511')
    expect(nextDrawPeriod('2026-11-25')).toBe('11509') // 開獎當天還能對
    expect(nextDrawPeriod('2026-11-24')).toBe('11509')
  })
})

describe('todayInTaipei', () => {
  it('回傳台北時區的 YYYY-MM-DD', () => {
    expect(todayInTaipei()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('periodFromBarcode', () => {
  it('一維條碼年期別（偶數月）轉期別', () => {
    expect(periodFromBarcode('11510')).toBe('11509')
    expect(periodFromBarcode('11512')).toBe('11511')
    expect(periodFromBarcode('11602')).toBe('11601')
  })

  it('非 02–12 的偶數月回傳 null', () => {
    expect(periodFromBarcode('11500')).toBeNull()
    expect(periodFromBarcode('11501')).toBeNull() // 奇數月
    expect(periodFromBarcode('11511')).toBeNull() // 奇數月
    expect(periodFromBarcode('11513')).toBeNull() // 超過 12 月
    expect(periodFromBarcode('11514')).toBeNull()
    expect(periodFromBarcode('abcde')).toBeNull()
    expect(periodFromBarcode('1151')).toBeNull()
  })
})
