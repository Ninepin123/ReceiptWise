// imageScan.js 純函式測試：多筆解碼結果分類去重、掃描區域規劃（nextRegion）。
import { describe, it, expect } from 'vitest'
import { MAX_SCAN_ATTEMPTS, SCAN_REGIONS, classifyScanTexts, nextRegion } from './imageScan.js'

// 組出符合格式的左側 QR 字串（前 77 碼固定欄位）
function leftQr(number = 'AB12345678') {
  return (
    number + '1151018' + '1234' + '0000006E' + '00000078' + '00000000' + '12345678' + 'A'.repeat(24)
  )
}

// 右側 QR：** 開頭，接同樣的品目區段（自行使用區:本碼品目數:總品目數:編碼參數:品目…）
const RIGHT_QR = '**:**********:2:2:1:便當:1:100:紅茶:1:20'
const BARCODE = '11510AB123456781234'

describe('classifyScanTexts', () => {
  it('一張圖同時解出左右 QR：兩種都保留', () => {
    const result = classifyScanTexts([RIGHT_QR, leftQr()])
    expect(result.rightQr.kind).toBe('right-qr')
    expect(result.rightQr.items).toEqual([
      { name: '便當', qty: 1, price: 100 },
      { name: '紅茶', qty: 1, price: 20 }
    ])
    expect(result.leftQr.kind).toBe('left-qr')
    expect(result.leftQr.number).toBe('AB12345678')
    expect(result.leftQr.totalAmount).toBe(120)
  })

  it('只有右側 QR：leftQr 為 null', () => {
    const result = classifyScanTexts([RIGHT_QR])
    expect(result.leftQr).toBeNull()
    expect(result.rightQr.kind).toBe('right-qr')
    expect(result.barcode).toBeNull()
  })

  it('一維條碼', () => {
    const result = classifyScanTexts([BARCODE])
    expect(result.barcode).toMatchObject({ kind: 'barcode', number: 'AB12345678', randomCode: '1234', period: '11509' })
    expect(result.leftQr).toBeNull()
  })

  it('無法辨識的文字收集到 unknown', () => {
    const result = classifyScanTexts(['https://example.com', ''])
    expect(result.unknown).toHaveLength(1)
    expect(result.unknown[0].kind).toBe('unknown')
  })

  it('重複文字只算一次；多個同類結果取第一個', () => {
    const first = leftQr('AB12345678')
    const second = leftQr('CD87654321')
    const result = classifyScanTexts([first, first, second, BARCODE, BARCODE])
    expect(result.leftQr.number).toBe('AB12345678')
    expect(result.barcode.number).toBe('AB12345678')
  })

  it('空輸入與非字串都安全', () => {
    expect(classifyScanTexts([])).toEqual({ leftQr: null, rightQr: null, barcode: null, unknown: [] })
    expect(classifyScanTexts(null)).toEqual({ leftQr: null, rightQr: null, barcode: null, unknown: [] })
    expect(classifyScanTexts([null, undefined, '  ']).unknown).toHaveLength(0)
  })
})

describe('nextRegion：掃描區域規劃', () => {
  it('區域清單：整張圖在前，左側再右側，數量不超過嘗試上限', () => {
    expect(SCAN_REGIONS[0]).toBeNull()
    expect(SCAN_REGIONS.slice(1, 5).every((r) => r[1] < 1)).toBe(true) // 左側
    expect(SCAN_REGIONS.slice(5).every((r) => r[1] === 1)).toBe(true) // 右側
    expect(SCAN_REGIONS.length).toBeLessThanOrEqual(MAX_SCAN_ATTEMPTS)
  })

  it('初始先試整張圖，失敗後依序試左側區域', () => {
    expect(nextRegion({ index: 0, hasLeft: false, hasRight: false })).toEqual({ index: 0, region: null })
    expect(nextRegion({ index: 1, hasLeft: false, hasRight: false })).toEqual({ index: 1, region: [0, 0.6] })
    expect(nextRegion({ index: 2, hasLeft: false, hasRight: false })).toEqual({ index: 2, region: [0, 0.55] })
    expect(nextRegion({ index: 3, hasLeft: false, hasRight: false })).toEqual({ index: 3, region: [0, 0.5] })
    expect(nextRegion({ index: 4, hasLeft: false, hasRight: false })).toEqual({ index: 4, region: [0, 0.7] })
  })

  it('解到左側 QR 後跳過左側區域，直接試右側', () => {
    expect(nextRegion({ index: 2, hasLeft: true, hasRight: false })).toEqual({ index: 5, region: [0.5, 1] })
    expect(nextRegion({ index: 3, hasLeft: true, hasRight: false })).toEqual({ index: 5, region: [0.5, 1] })
  })

  it('左右都解到就結束', () => {
    expect(nextRegion({ index: 5, hasLeft: true, hasRight: true })).toBeNull()
    expect(nextRegion({ index: 0, hasLeft: true, hasRight: true })).toBeNull()
  })

  it('只有右側 QR 時左側區域仍要試（左 QR 資訊較完整），左側試完就結束', () => {
    expect(nextRegion({ index: 4, hasLeft: false, hasRight: true })).toEqual({ index: 4, region: [0, 0.7] })
    expect(nextRegion({ index: 5, hasLeft: false, hasRight: true })).toBeNull()
  })

  it('全部區域試完回傳 null', () => {
    expect(nextRegion({ index: SCAN_REGIONS.length, hasLeft: false, hasRight: false })).toBeNull()
  })

  it('模擬實測情境：整張失敗 → 左 0.6 成功 → 右 0.5 成功，共 3 次嘗試', () => {
    const state = { index: 0, hasLeft: false, hasRight: false }
    const tried = []
    while (tried.length < MAX_SCAN_ATTEMPTS) {
      const next = nextRegion(state)
      if (!next) break
      state.index = next.index + 1
      tried.push(next.region)
      // 情境：整張圖解不出來（zxing 看到兩組定位點會失敗），裁切後每個區域都成功
      if (next.region === null) continue
      if (next.region[1] < 1) state.hasLeft = true
      else state.hasRight = true
    }
    expect(tried).toEqual([null, [0, 0.6], [0.5, 1]])
  })

  it('模擬全部失敗：會試完所有區域且不超過上限', () => {
    const state = { index: 0, hasLeft: false, hasRight: false }
    const tried = []
    while (tried.length < MAX_SCAN_ATTEMPTS) {
      const next = nextRegion(state)
      if (!next) break
      state.index = next.index + 1
      tried.push(next.region)
    }
    expect(tried).toEqual(SCAN_REGIONS)
    expect(tried.length).toBeLessThanOrEqual(MAX_SCAN_ATTEMPTS)
  })

  it('模擬只有右側可解：先試完整張與所有左側，再試右側第一個就停', () => {
    const state = { index: 0, hasLeft: false, hasRight: false }
    const tried = []
    while (tried.length < MAX_SCAN_ATTEMPTS) {
      const next = nextRegion(state)
      if (!next) break
      state.index = next.index + 1
      tried.push(next.region)
      // 只有右側區域解得到東西
      if (next.region !== null && next.region[1] === 1) state.hasRight = true
    }
    expect(tried).toEqual([null, [0, 0.6], [0, 0.55], [0, 0.5], [0, 0.7], [0.5, 1]])
  })
})
