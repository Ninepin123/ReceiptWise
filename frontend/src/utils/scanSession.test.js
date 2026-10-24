// scanSession.js 狀態機測試：左 QR 立即採用、右 QR 暫存／合併只算一次、一維條碼寬限期。
import { describe, it, expect } from 'vitest'
import { BARCODE_GRACE_MS, createScanSession, handleScanTexts, scanTick } from './scanSession.js'

// 組出符合格式的左側 QR 字串（前 77 碼固定欄位）
function leftQrText(number = 'AB12345678') {
  return (
    number + '1151018' + '1234' + '0000006E' + '00000078' + '00000000' + '12345678' + 'A'.repeat(24)
  )
}

const RIGHT_A = '**:**********:2:2:1:便當:1:100:紅茶:1:20'
const RIGHT_B = '**:**********:1:1:1:咖啡:1:65'
const BARCODE_TEXT = '11510AB123456781234'

describe('handleScanTexts：左側 QR', () => {
  it('讀到左側 QR 馬上回傳 apply-left（含截止時間外的右側品目）', () => {
    const state = createScanSession()
    const actions = handleScanTexts(state, [leftQrText()], 1000)
    expect(actions).toEqual([
      { action: 'apply-left', parsed: expect.objectContaining({ kind: 'left-qr', number: 'AB12345678' }), rightItems: [] }
    ])
  })

  it('同畫面有右側 QR 時，品目跟著 apply-left 合併', () => {
    const state = createScanSession()
    const actions = handleScanTexts(state, [RIGHT_A, leftQrText()], 1000)
    expect(actions).toHaveLength(1)
    expect(actions[0].action).toBe('apply-left')
    expect(actions[0].rightItems).toEqual([
      { name: '便當', qty: 1, price: 100 },
      { name: '紅茶', qty: 1, price: 20 }
    ])
    // 已合併的右側 QR 記錄下來
    expect(state.mergedRightQrRaw).toBe(RIGHT_A)
  })

  it('先右後左：暫存的右側品目在 apply-left 時合併，且同一個只合併一次', () => {
    const state = createScanSession()
    // 第一張畫面只有右側 QR → 暫存
    expect(handleScanTexts(state, [RIGHT_A], 1000)).toEqual([
      { action: 'store-right', parsed: expect.objectContaining({ kind: 'right-qr' }) }
    ])
    // 第二張畫面右側 QR 又出現（與左 QR 同畫面）：合併一次
    const actions = handleScanTexts(state, [RIGHT_A, leftQrText()], 1200)
    expect(actions).toHaveLength(1)
    expect(actions[0].action).toBe('apply-left')
    expect(actions[0].rightItems).toEqual([
      { name: '便當', qty: 1, price: 100 },
      { name: '紅茶', qty: 1, price: 20 }
    ])
    expect(state.mergedRightQrRaw).toBe(RIGHT_A)
    // 同一個右側 QR 之後再跟著左 QR 出現（例如重掃）：不會再合併一次
    const again = handleScanTexts(state, [RIGHT_A, leftQrText('CD87654321')], 1300)
    expect(again[0].action).toBe('apply-left')
    expect(again[0].rightItems).toEqual([])
  })

  it('先暫存右側、之後才掃到左側：合併的是暫存的品目', () => {
    const state = createScanSession()
    handleScanTexts(state, [RIGHT_A], 1000)
    const actions = handleScanTexts(state, [leftQrText()], 1500)
    expect(actions[0].action).toBe('apply-left')
    expect(actions[0].rightItems).toEqual([
      { name: '便當', qty: 1, price: 100 },
      { name: '紅茶', qty: 1, price: 20 }
    ])
  })
})

describe('handleScanTexts：右側 QR', () => {
  it('表單沒有左側資料時只暫存（取代，不累加），繼續掃', () => {
    const state = createScanSession()
    handleScanTexts(state, [RIGHT_A], 1000)
    // 同一個右側 QR 再讀到：pendingRightQr 被取代，品目沒有兩份
    handleScanTexts(state, [RIGHT_A], 1200)
    expect(state.pendingRightQr.items).toHaveLength(2)
    // 換成不同的右側 QR 也一樣只有一份（新品目）
    handleScanTexts(state, [RIGHT_B], 1400)
    expect(state.pendingRightQr.raw).toBe(RIGHT_B)
    expect(state.pendingRightQr.items).toEqual([{ name: '咖啡', qty: 1, price: 65 }])
  })

  it('表單已有左側資料（hasLeftData）時合併品目，同一個只合併一次', () => {
    const state = createScanSession()
    const first = handleScanTexts(state, [RIGHT_A], 1000, { hasLeftData: true })
    expect(first).toEqual([{ action: 'merge-right', parsed: expect.objectContaining({ kind: 'right-qr' }) }])
    // 同一個右側 QR 又掃到：不再合併（也沒有其他動作）
    expect(handleScanTexts(state, [RIGHT_A], 1300, { hasLeftData: true })).toEqual([])
    // 不同的右側 QR：合併一次
    const second = handleScanTexts(state, [RIGHT_B], 1600, { hasLeftData: true })
    expect(second[0].action).toBe('merge-right')
    expect(handleScanTexts(state, [RIGHT_B], 1900, { hasLeftData: true })).toEqual([])
  })
})

describe('handleScanTexts：一維條碼寬限期', () => {
  it('只讀到一維條碼：進入寬限期，deadline = 現在 + 1500ms，不採用', () => {
    const state = createScanSession()
    const actions = handleScanTexts(state, [BARCODE_TEXT], 1000)
    expect(actions).toEqual([
      {
        action: 'barcode-grace',
        parsed: expect.objectContaining({ kind: 'barcode', number: 'AB12345678' }),
        deadline: 1000 + BARCODE_GRACE_MS
      }
    ])
    expect(BARCODE_GRACE_MS).toBe(1500)
  })

  it('寬限期內重複讀到同一張條碼不再觸發動作（等 tick）', () => {
    const state = createScanSession()
    handleScanTexts(state, [BARCODE_TEXT], 1000)
    expect(handleScanTexts(state, [BARCODE_TEXT], 1800)).toEqual([])
    // 寬限期也不因為重複讀到而順延
    expect(scanTick(state, 1000 + BARCODE_GRACE_MS)).toEqual({
      action: 'apply-barcode',
      parsed: expect.objectContaining({ kind: 'barcode' })
    })
  })

  it('寬限期內讀到左側 QR：改用左側 QR，條碼作廢', () => {
    const state = createScanSession()
    handleScanTexts(state, [BARCODE_TEXT], 1000)
    const actions = handleScanTexts(state, [leftQrText()], 2000)
    expect(actions).toHaveLength(1)
    expect(actions[0].action).toBe('apply-left')
    expect(state.pendingBarcode).toBeNull()
    expect(scanTick(state, 3000)).toBeNull()
  })

  it('寬限期內讀到右側 QR：右側照規則暫存，條碼寬限期不受影響', () => {
    const state = createScanSession()
    handleScanTexts(state, [BARCODE_TEXT], 1000)
    const actions = handleScanTexts(state, [RIGHT_A], 1200)
    expect(actions.map((a) => a.action)).toEqual(['store-right'])
    // 條碼還在等左側 QR（tick 未到期前不採用）
    expect(scanTick(state, 2400)).toBeNull()
    expect(scanTick(state, 2500).action).toBe('apply-barcode')
  })

  it('只有一維條碼時，寬限期到了才採用（scanTick）', () => {
    const state = createScanSession()
    handleScanTexts(state, [BARCODE_TEXT], 1000)
    // 還沒到期
    expect(scanTick(state, 1000 + BARCODE_GRACE_MS - 1)).toBeNull()
    // 到期：採用一次，之後不會再給
    const action = scanTick(state, 1000 + BARCODE_GRACE_MS)
    expect(action.action).toBe('apply-barcode')
    expect(action.parsed.number).toBe('AB12345678')
    expect(scanTick(state, 9999)).toBeNull()
  })

  it('寬限期中換成不同條碼：採用新號碼，但期限不重新起算', () => {
    const state = createScanSession()
    handleScanTexts(state, [BARCODE_TEXT], 1000)
    handleScanTexts(state, ['11510CD876543211234'], 2200)
    const action = scanTick(state, 2500)
    expect(action.parsed.number).toBe('CD87654321')
  })
})

describe('handleScanTexts：immediateBarcode（拍照模式）', () => {
  it('一維條碼直接回 apply-barcode，不留寬限期狀態', () => {
    const state = createScanSession()
    const actions = handleScanTexts(state, [BARCODE_TEXT], 1000, { immediateBarcode: true })
    expect(actions).toEqual([{ action: 'apply-barcode', parsed: expect.objectContaining({ kind: 'barcode' }) }])
    expect(state.pendingBarcode).toBeNull()
    expect(state.barcodeSeenAt).toBe(0)
    expect(scanTick(state, 9999)).toBeNull()
  })

  it('同一張只有一維條碼的照片重複上傳，每次都回 apply-barcode（不會被狀態卡住）', () => {
    const state = createScanSession()
    handleScanTexts(state, [BARCODE_TEXT], 1000, { immediateBarcode: true })
    const second = handleScanTexts(state, [BARCODE_TEXT], 2000, { immediateBarcode: true })
    expect(second).toEqual([{ action: 'apply-barcode', parsed: expect.objectContaining({ number: 'AB12345678' }) }])
  })

  it('換一張只有一維條碼的照片也每次都採用', () => {
    const state = createScanSession()
    handleScanTexts(state, [BARCODE_TEXT], 1000, { immediateBarcode: true })
    const second = handleScanTexts(state, ['11510CD876543211234'], 2000, { immediateBarcode: true })
    expect(second[0].action).toBe('apply-barcode')
    expect(second[0].parsed.number).toBe('CD87654321')
  })

  it('有左側 QR 時一樣優先，不回條碼動作', () => {
    const state = createScanSession()
    const actions = handleScanTexts(state, [BARCODE_TEXT, leftQrText()], 1000, { immediateBarcode: true })
    expect(actions).toHaveLength(1)
    expect(actions[0].action).toBe('apply-left')
  })

  it('沒開選項（相機模式）仍進寬限期，行為不變', () => {
    const state = createScanSession()
    const actions = handleScanTexts(state, [BARCODE_TEXT], 1000)
    expect(actions[0].action).toBe('barcode-grace')
    expect(state.pendingBarcode).not.toBeNull()
  })

  it('拍照的右側 QR 規則不受影響：只有右 QR 時仍暫存', () => {
    const state = createScanSession()
    const actions = handleScanTexts(state, [RIGHT_A], 1000, { immediateBarcode: true })
    expect(actions.map((a) => a.action)).toEqual(['store-right'])
  })
})

describe('handleScanTexts：無法辨識與空輸入', () => {
  it('只有無法辨識的文字 → unrecognized（呼叫端短暫提示）', () => {
    const state = createScanSession()
    expect(handleScanTexts(state, ['https://example.com'], 1000)).toEqual([{ action: 'unrecognized' }])
  })

  it('與可辨識的結果同畫面時，無法辨識的不影響流程', () => {
    const state = createScanSession()
    const actions = handleScanTexts(state, ['https://example.com', leftQrText()], 1000)
    expect(actions.map((a) => a.action)).toEqual(['apply-left'])
  })

  it('空陣列與 null 都安全', () => {
    const state = createScanSession()
    expect(handleScanTexts(state, [], 1000)).toEqual([])
    expect(handleScanTexts(state, null, 1000)).toEqual([])
  })

  it('重複文字只處理一次', () => {
    const state = createScanSession()
    const actions = handleScanTexts(state, [RIGHT_A, RIGHT_A, RIGHT_A], 1000)
    expect(actions).toHaveLength(1)
  })
})
