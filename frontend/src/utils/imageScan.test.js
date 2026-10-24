// imageScan.js 純函式測試：解碼結果分類去重、拍照解析的嘗試計畫與像素前處理。
import { describe, it, expect } from 'vitest'
import {
  classifyScanTexts,
  contrastStretch,
  cropImageData,
  planImageAttempts,
  resizeImageData
} from './imageScan.js'

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

describe('planImageAttempts：拍照解析的嘗試計畫', () => {
  it('初始狀態：native（有支援）→ 原圖 → 對比加強 → 左右裁切 → 大圖再試縮圖', () => {
    expect(planImageAttempts({ hasLeft: false, hasRight: false, longestSide: 3000, hasNative: true })).toEqual([
      'native',
      'full',
      'contrast',
      'crop-left',
      'crop-right',
      'small'
    ])
  })

  it('沒有原生 BarcodeDetector 就不排 native', () => {
    const steps = planImageAttempts({ hasLeft: false, hasRight: false, longestSide: 3000, hasNative: false })
    expect(steps[0]).toBe('full')
    expect(steps).not.toContain('native')
  })

  it('最長邊 2400 以下不排 small（2400 也不排，超過才排）', () => {
    expect(planImageAttempts({ longestSide: 2400, hasNative: false })).not.toContain('small')
    expect(planImageAttempts({ longestSide: 2401, hasNative: false })).toContain('small')
  })

  it('已解到右側 QR 就跳過右側裁切，左側仍要試（左 QR 資訊較完整）', () => {
    const steps = planImageAttempts({ hasLeft: false, hasRight: true, longestSide: 3000, hasNative: false })
    expect(steps).toEqual(['full', 'contrast', 'crop-left', 'small'])
  })

  it('已解到左側 QR 就不用再試任何步驟', () => {
    expect(planImageAttempts({ hasLeft: true, hasRight: false, longestSide: 3000, hasNative: true })).toEqual([])
  })

  it('模擬實測情境：native 只解到右 QR → 重排後沒有 crop-right（native 由呼叫端標記已做）', () => {
    // 第一步 native 解到右側 QR（沒有左側）；plan 本身不知道哪些做過，
    // 呼叫端用 done 集合跳過 native，這裡只驗證裁切規則有更新
    const afterNative = planImageAttempts({ hasLeft: false, hasRight: true, longestSide: 1600, hasNative: true })
    expect(afterNative).toEqual(['native', 'full', 'contrast', 'crop-left'])
    expect(afterNative).not.toContain('crop-right')
    // 接著 full 解到左側 QR → 重排得到 []，流程結束
    expect(planImageAttempts({ hasLeft: true, hasRight: true, longestSide: 1600, hasNative: true })).toEqual([])
  })
})

// 產生灰階 RGBA 測試圖（每個像素填同一個亮度值）
function grayImage(values, width) {
  const height = values.length / width
  const data = new Uint8ClampedArray(values.length * 4)
  values.forEach((v, i) => {
    data[i * 4] = v
    data[i * 4 + 1] = v
    data[i * 4 + 2] = v
    data[i * 4 + 3] = 255
  })
  return { data, width, height }
}

describe('contrastStretch：對比拉伸', () => {
  it('偏灰的影像（亮度 60–120）被拉伸到接近 0–255', () => {
    // 100 像素：亮度 60～119 均勻分布，第 2／98 百分位約在 61／118
    const values = Array.from({ length: 100 }, (_, i) => 60 + (i % 60))
    const image = grayImage(values, 10)
    const out = contrastStretch(image)
    expect(out.width).toBe(10)
    expect(out.height).toBe(10)
    const levels = new Set()
    for (let i = 0; i < 100; i++) {
      // 輸出是灰階：RGB 三通道相同
      expect(out.data[i * 4]).toBe(out.data[i * 4 + 1])
      expect(out.data[i * 4]).toBe(out.data[i * 4 + 2])
      expect(out.data[i * 4 + 3]).toBe(255)
      levels.add(out.data[i * 4])
    }
    expect(Math.min(...levels)).toBeLessThanOrEqual(5) // 暗端被拉到接近 0
    expect(Math.max(...levels)).toBeGreaterThanOrEqual(250) // 亮端被拉到接近 255
  })

  it('黑白分明（0 與 255 各半）的影像維持原狀', () => {
    const values = Array.from({ length: 100 }, (_, i) => (i % 2 ? 255 : 0))
    const out = contrastStretch(grayImage(values, 10))
    const levels = [...new Set(Array.from({ length: 100 }, (_, i) => out.data[i * 4]))]
    expect(levels.sort((a, b) => a - b)).toEqual([0, 255])
  })

  it('整張同亮度（low == high）不會壞掉，保留原值', () => {
    const out = contrastStretch(grayImage(new Array(64).fill(77), 8))
    expect(out.data[0]).toBe(77)
    expect(out.data[63 * 4]).toBe(77)
  })
})

describe('cropImageData：水平裁切', () => {
  it('裁左 0–0.6：寬度取整、內容對齊、垂直保留整張', () => {
    const image = grayImage(Array.from({ length: 200 }, (_, i) => i % 100), 20) // 20×10
    const out = cropImageData(image, 0, 0.6)
    expect(out.width).toBe(12) // 20 * 0.6
    expect(out.height).toBe(10)
    // 第 2 列第 1 個像素對應原圖 (row 1, col 0) = i 20，亮度 20
    expect(out.data[1 * 12 * 4]).toBe(20)
  })

  it('裁右 0.4–1 的起始像素對齊原圖位置', () => {
    const image = grayImage(Array.from({ length: 200 }, (_, i) => i % 100), 20)
    const out = cropImageData(image, 0.4, 1)
    expect(out.width).toBe(12) // 20 * 0.6
    // 原圖 x = round(20*0.4) = 8，第 0 列亮度 8
    expect(out.data[0]).toBe(8)
  })

  it('邊界夾到 0–1，且至少留 1px 寬', () => {
    const image = grayImage(new Array(12).fill(9), 4)
    const out = cropImageData(image, -1, 0.01)
    expect(out.width).toBe(1)
    expect(out.height).toBe(3)
  })
})

describe('resizeImageData：等比例縮小', () => {
  it('小於等於目標尺寸直接回傳原物件（不放大）', () => {
    const image = grayImage(new Array(16).fill(50), 4)
    expect(resizeImageData(image, 8)).toBe(image)
  })

  it('4×4 縮成 2×2：每個輸出像素是對應 2×2 區塊的平均', () => {
    // 4×4，值 0,4,8…60（避免平均後出現 .5 被 Uint8ClampedArray 四捨五入）
    const image = grayImage(Array.from({ length: 16 }, (_, i) => i * 4), 4)
    const out = resizeImageData(image, 2)
    expect(out.width).toBe(2)
    expect(out.height).toBe(2)
    expect(out.data[0]).toBe(10) // (0+4+16+20)/4
    expect(out.data[4]).toBe(18) // (8+12+24+28)/4
    expect(out.data[8]).toBe(42) // (32+36+48+52)/4
    expect(out.data[12]).toBe(50) // (40+44+56+60)/4
  })

  it('非整數比例（3×2 → 最長邊 2）長寬按比例取整，內容是加權平均', () => {
    const image = grayImage(new Array(6).fill(30), 3) // 3×2
    const out = resizeImageData(image, 2)
    expect(out.width).toBe(2)
    expect(out.height).toBe(1)
    expect(out.data[0]).toBe(30)
    expect(out.data[4]).toBe(30)
  })
})
