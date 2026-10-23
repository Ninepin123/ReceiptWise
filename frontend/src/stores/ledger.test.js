// ledger store 測試：mock api/client，搭配記憶體 localStorage（node 環境沒有）。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// 簡單的記憶體 localStorage
class MemoryStorage {
  constructor() {
    this.map = new Map()
  }
  get length() {
    return this.map.size
  }
  key(index) {
    return [...this.map.keys()][index] ?? null
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null
  }
  setItem(key, value) {
    this.map.set(String(key), String(value))
  }
  removeItem(key) {
    this.map.delete(key)
  }
  clear() {
    this.map.clear()
  }
}
globalThis.localStorage = new MemoryStorage()

// 只 mock api 的方法，ApiError / NetworkError 用真的類別（instanceOf 才會成立）
vi.mock('../api/client', async () => {
  const actual = await vi.importActual('../api/client')
  return {
    ...actual,
    api: {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn(),
      del: vi.fn()
    }
  }
})

import { api, ApiError, NetworkError } from '../api/client'
import { useAuthStore } from './auth'
import { useLedgerStore } from './ledger'

// 等一個 macrotask，讓 flush 走到 await api.put 那一行
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  localStorage.clear()
  vi.resetAllMocks()
  setActivePinia(createPinia())
  const auth = useAuthStore()
  auth.token = 'test-token'
  auth.user = { id: 1, email: 'test@example.com', displayName: '測試' }
  // 預設值，個別測試可覆寫
  api.get.mockResolvedValue({ transactions: [], invoices: [] })
  api.del.mockResolvedValue(null)
})

describe('ledger store', () => {
  it('儲存發票：put 被呼叫、outbox 清空、本機以伺服器回傳為準', async () => {
    const ledger = useLedgerStore()
    api.put.mockImplementation((_path, body) =>
      Promise.resolve({
        invoice: { ...body, period: '11509', prizeStatus: 'pending', prizeName: null, prizeAmount: 0, checkedAt: null }
      })
    )

    const saved = await ledger.saveInvoice({ number: 'ab-1234 5678', date: '2026-10-18', amount: 120 })

    expect(api.put).toHaveBeenCalledTimes(1)
    expect(api.put.mock.calls[0][0]).toMatch(/^\/invoices\//)
    expect(api.put.mock.calls[0][1].number).toBe('AB12345678') // 號碼已正規化
    expect(ledger.pendingCount).toBe(0)
    expect(saved.number).toBe('AB12345678')
    expect(ledger.invoices).toHaveLength(1)
    expect(ledger.invoices[0].period).toBe('11509')
    expect(ledger.invoices[0].prizeStatus).toBe('pending')
  })

  it('儲存收支：put 被呼叫、outbox 清空、本機資料被伺服器回傳覆蓋', async () => {
    const ledger = useLedgerStore()
    api.put.mockImplementation((_path, body) =>
      Promise.resolve({ transaction: { ...body, createdAt: '2026-10-01T00:00:00Z' } })
    )

    await ledger.saveTransaction({ type: 'expense', title: '午餐', category: '餐飲', amount: 120, date: '2026-10-19' })

    expect(api.put).toHaveBeenCalledTimes(1)
    expect(ledger.pendingCount).toBe(0)
    expect(ledger.transactions).toHaveLength(1)
    expect(ledger.transactions[0].title).toBe('午餐')
    expect(ledger.status).toBe('idle')
  })

  it('斷線：佇列保留、狀態 offline，之後 flush 會把修改送出', async () => {
    const ledger = useLedgerStore()
    api.put.mockRejectedValueOnce(new NetworkError())

    await ledger.saveTransaction({ type: 'expense', title: '午餐', category: '餐飲', amount: 100, date: '2026-10-01' })

    expect(ledger.status).toBe('offline')
    expect(ledger.pendingCount).toBe(1)
    expect(ledger.lastError).toBeNull()

    api.put.mockImplementationOnce((_path, body) => Promise.resolve({ transaction: body }))
    await ledger.flush()

    expect(api.put).toHaveBeenCalledTimes(2)
    expect(ledger.pendingCount).toBe(0)
    expect(ledger.status).toBe('idle')
  })

  it('送出期間又修改同一筆：兩次修改都會送出，本機最終是新資料', async () => {
    const ledger = useLedgerStore()
    const id = crypto.randomUUID()
    const serverOf = (title, amount) => ({
      transaction: {
        id,
        type: 'expense',
        title,
        category: '餐飲',
        amount,
        date: '2026-10-01',
        note: '',
        invoiceId: null,
        createdAt: '2026-10-01T00:00:00Z'
      }
    })
    let resolveFirst
    api.put.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
    // 第二次以後：伺服器照收到的 body 回
    api.put.mockImplementation((_path, body) =>
      Promise.resolve({ transaction: { ...body, createdAt: '2026-10-01T00:00:00Z' } })
    )

    const first = ledger.saveTransaction({ id, type: 'expense', title: 'v1', category: '餐飲', amount: 100, date: '2026-10-01' })
    await tick() // flush 開始並停在第一個 put
    expect(api.put).toHaveBeenCalledTimes(1)

    // 使用者在送出期間又存了同一筆
    await ledger.saveTransaction({ id, type: 'expense', title: 'v2', category: '餐飲', amount: 200, date: '2026-10-01' })
    expect(ledger.pendingCount).toBe(2) // 送出中的那筆不能被合併掉

    resolveFirst(serverOf('v1', 100)) // 第一筆的伺服器回應（舊資料）
    await first

    expect(api.put).toHaveBeenCalledTimes(2)
    expect(api.put.mock.calls[0][1].title).toBe('v1')
    expect(api.put.mock.calls[1][1].title).toBe('v2')
    expect(ledger.pendingCount).toBe(0)
    const local = ledger.transactions.find((t) => t.id === id)
    expect(local.title).toBe('v2') // 舊回應（v1）不能蓋掉新修改
    expect(local.amount).toBe(200)
  })

  it('409：該筆被丟掉、lastError 記伺服器訊息、重抓伺服器資料', async () => {
    const ledger = useLedgerStore()
    api.put.mockRejectedValue(new ApiError(409, 'duplicate_invoice', '這個發票號碼已經存在'))

    await ledger.saveInvoice({ number: 'AB12345678', date: '2026-10-18', amount: 10 })

    expect(ledger.pendingCount).toBe(0)
    expect(ledger.lastError?.message).toBe('這個發票號碼已經存在')
    expect(api.get).toHaveBeenCalled() // 重抓修正畫面
  })

  it('401：佇列保留不丟資料', async () => {
    const ledger = useLedgerStore()
    api.put.mockRejectedValue(new ApiError(401, 'unauthorized', '請先登入'))

    await ledger.saveTransaction({ type: 'expense', title: '午餐', category: '餐飲', amount: 100, date: '2026-10-01' })

    expect(ledger.pendingCount).toBe(1)
    expect(ledger.status).toBe('error')
    expect(ledger.lastError?.message).toBe('登入已過期，請重新登入')
  })

  it('500：佇列保留（暫時性錯誤）', async () => {
    const ledger = useLedgerStore()
    api.put.mockRejectedValue(new ApiError(500, 'internal_error', '伺服器發生錯誤'))

    await ledger.saveTransaction({ type: 'expense', title: '午餐', category: '餐飲', amount: 100, date: '2026-10-01' })

    expect(ledger.pendingCount).toBe(1)
    expect(ledger.status).toBe('error')
  })

  it('刪除發票：本機關聯交易的 invoiceId 改為 null', async () => {
    const ledger = useLedgerStore()
    api.put.mockImplementation((_path, body) =>
      Promise.resolve({ invoice: { ...body, period: '11509', prizeStatus: 'pending' } })
    )
    const invoice = await ledger.saveInvoice({ number: 'AB12345678', date: '2026-10-18', amount: 5 })

    api.put.mockImplementation((_path, body) => Promise.resolve({ transaction: body }))
    const tx = await ledger.saveTransaction({
      type: 'expense',
      title: '便當',
      category: '餐飲',
      amount: 5,
      date: '2026-10-18',
      invoiceId: invoice.id
    })
    expect(tx.invoiceId).toBe(invoice.id)

    await ledger.deleteInvoice(invoice.id)

    expect(api.del).toHaveBeenCalledWith(`/invoices/${invoice.id}`)
    expect(ledger.invoices).toHaveLength(0)
    expect(ledger.transactions.find((t) => t.id === tx.id).invoiceId).toBeNull()
    expect(ledger.pendingCount).toBe(0)
  })

  it('load()：佇列送不出去時不會 GET 重抓（不蓋掉本機修改）', async () => {
    const tx = {
      id: '11111111-1111-1111-1111-111111111111',
      type: 'expense',
      title: '離線新增',
      category: '餐飲',
      amount: 100,
      date: '2026-10-01',
      note: '',
      invoiceId: null,
      createdAt: '2026-10-01T00:00:00Z'
    }
    // 模擬上次離線留下的快取和待同步操作
    localStorage.setItem(
      'receiptwise-cache-1',
      JSON.stringify({ transactions: [tx], invoices: [], savedAt: '2026-10-01T00:00:00Z' })
    )
    localStorage.setItem(
      'receiptwise-outbox-1',
      JSON.stringify([
        { opId: 'op-1', kind: 'transaction', action: 'put', id: tx.id, data: tx, queuedAt: '2026-10-01T00:00:00Z' }
      ])
    )
    api.put.mockRejectedValue(new NetworkError())

    const ledger = useLedgerStore()
    await ledger.load()

    expect(ledger.transactions).toHaveLength(1) // 快取先顯示
    expect(api.put).toHaveBeenCalledTimes(1)
    expect(api.get).not.toHaveBeenCalled() // 佇列未清空 → 不重抓
    expect(ledger.status).toBe('offline')
    expect(ledger.pendingCount).toBe(1)
  })
})
