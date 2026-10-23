// 帳本 store：收支 + 發票的快取、離線 outbox 與樂觀更新。
// 流程照 ARCHITECTURE.md 第 8 節：
//   load()     快取 → flush() → 佇列清空後才 refresh() 重抓
//   flush()    依序送 outbox。斷線、401、5xx 等暫時性錯誤停止並保留佇列
//              （30 秒後自動重試）；只有明確的用戶端錯誤（400/403/404/409/422）
//              才丟掉該筆操作並記 lastError
//   save/delete 先更新畫面與快取，再加入 outbox 後 flush()
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api, ApiError, NetworkError } from '../api/client'
import { STORAGE_KEYS } from '../constants'
import { useAuthStore } from './auth'
import { normalizeInvoiceNumber } from '../utils/format'
import { periodOf } from '../utils/period'
import { uuid } from '../utils/uuid'

// 日期新到舊，同日期再看 createdAt 新到舊
const byDateDesc = (a, b) =>
  b.date.localeCompare(a.date) || String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))

// 這些狀態代表資料本身有問題，重送也不會成功，才可以丟掉該筆操作
const DISCARDABLE_STATUSES = [400, 403, 404, 409, 422]

// 暫時性失敗後自動重試的間隔
const RETRY_DELAY_MS = 30000

export const useLedgerStore = defineStore('ledger', () => {
  const auth = useAuthStore()

  const transactions = ref([])
  const invoices = ref([])
  const outbox = ref([])
  const status = ref('idle') // idle / syncing / offline / error
  const lastSyncedAt = ref(null)
  const lastError = ref(null) // { message, at }
  const loaded = ref(false)
  let flushing = false // 同一時間只允許一個 flush
  let inFlightOpId = null // 正在送出的操作，enqueue 合併時不能動它
  let retryTimer = null // 保留佇列停止後的自動重試計時器

  // 對外一律排序過
  const sortedTransactions = computed(() => [...transactions.value].sort(byDateDesc))
  const sortedInvoices = computed(() => [...invoices.value].sort(byDateDesc))
  const pendingCount = computed(() => outbox.value.length)

  const userId = () => auth.user?.id ?? null

  // ---- localStorage 讀寫（容量滿或隱私模式可能丟例外，寫入要防呆） ----
  function readJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback
    } catch {
      return fallback
    }
  }

  function readCache() {
    const id = userId()
    if (id === null) return
    const cache = readJson(STORAGE_KEYS.cache(id), null)
    if (cache) {
      transactions.value = cache.transactions ?? []
      invoices.value = cache.invoices ?? []
    }
  }

  function writeCache() {
    const id = userId()
    if (id === null) return
    try {
      localStorage.setItem(
        STORAGE_KEYS.cache(id),
        JSON.stringify({
          transactions: transactions.value,
          invoices: invoices.value,
          savedAt: new Date().toISOString()
        })
      )
    } catch {
      // 寫不進去只影響下次啟動的速度，不影響運作
    }
  }

  function readOutbox() {
    const id = userId()
    if (id === null) return
    outbox.value = readJson(STORAGE_KEYS.outbox(id), [])
  }

  function writeOutbox() {
    const id = userId()
    if (id === null) return
    try {
      localStorage.setItem(STORAGE_KEYS.outbox(id), JSON.stringify(outbox.value))
    } catch {
      // 同上，忽略
    }
  }

  // ---- 本機資料維護 ----
  function upsertTransaction(item) {
    const idx = transactions.value.findIndex((t) => t.id === item.id)
    if (idx >= 0) transactions.value[idx] = item
    else transactions.value.push(item)
  }

  function upsertInvoice(item) {
    const idx = invoices.value.findIndex((i) => i.id === item.id)
    if (idx >= 0) invoices.value[idx] = item
    else invoices.value.push(item)
  }

  // 只移除指定的操作（用 opId 找，不用 shift，避免刪到送出期間新加入的操作）
  function dropOp(opId) {
    outbox.value = outbox.value.filter((o) => o.opId !== opId)
    writeOutbox()
  }

  // 加入待同步操作；同一 id 前面還沒「送出中」的 put 可合併掉，保留最新一筆
  function enqueue(op) {
    outbox.value = outbox.value.filter(
      (o) =>
        !(o.kind === op.kind && o.id === op.id && o.action === 'put' && o.opId !== inFlightOpId)
    )
    outbox.value.push({ opId: uuid(), queuedAt: new Date().toISOString(), ...op })
    writeOutbox()
  }

  // 保留佇列停止後的自動重試（不重複排程）
  function scheduleRetry() {
    if (retryTimer) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      flush()
    }, RETRY_DELAY_MS)
    // Node（測試環境）不要讓計時器卡住行程
    retryTimer.unref?.()
  }

  function clearRetry() {
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  // 暫時性失敗：停止 flush、保留佇列、安排重試
  function stopKeepQueue(message, nextState) {
    if (message) lastError.value = { message, at: new Date().toISOString() }
    status.value = nextState
    scheduleRetry()
  }

  // ---- 對外動作 ----
  // 登入後（或重新整理時）載入：快取立刻顯示 → flush → 重抓伺服器資料
  async function load() {
    if (!auth.isLoggedIn || loaded.value) return
    loaded.value = true
    readCache()
    readOutbox()
    await flush()
    await refresh()
  }

  // 從伺服器重抓兩個清單；佇列未清空前不抓，避免蓋掉還沒送出的修改
  async function refresh() {
    if (!auth.isLoggedIn) return
    if (outbox.value.length > 0) return
    status.value = 'syncing'
    try {
      const [tRes, iRes] = await Promise.all([api.get('/transactions'), api.get('/invoices')])
      transactions.value = tRes?.transactions ?? []
      invoices.value = iRes?.invoices ?? []
      lastSyncedAt.value = new Date().toISOString()
      status.value = 'idle'
      writeCache()
    } catch (err) {
      if (err instanceof NetworkError) {
        status.value = 'offline'
      } else {
        status.value = 'error'
        lastError.value = { message: err.message, at: new Date().toISOString() }
      }
    }
  }

  // 依序送出 outbox
  async function flush() {
    if (flushing || !auth.isLoggedIn) return
    if (outbox.value.length === 0) return
    flushing = true
    status.value = 'syncing'
    let hadError = false
    try {
      while (outbox.value.length > 0) {
        const op = outbox.value[0]
        inFlightOpId = op.opId
        const path = op.kind === 'transaction' ? `/transactions/${op.id}` : `/invoices/${op.id}`
        try {
          let res = null
          if (op.action === 'delete') {
            await api.del(path)
          } else {
            res = await api.put(path, op.data)
          }
          dropOp(op.opId)
          // 佇列裡沒有同 id 的後續操作，才用伺服器回傳覆蓋本機（避免舊回應蓋掉新修改）
          if (
            op.action === 'put' &&
            !outbox.value.some((o) => o.kind === op.kind && o.id === op.id)
          ) {
            if (op.kind === 'transaction' && res?.transaction) upsertTransaction(res.transaction)
            if (op.kind === 'invoice' && res?.invoice) upsertInvoice(res.invoice)
          }
        } catch (err) {
          if (err instanceof NetworkError) {
            // 斷線：保留佇列，等 online 事件或重試
            stopKeepQueue(null, 'offline')
            return
          }
          if (err instanceof ApiError && err.status === 401) {
            // 登入過期：保留佇列，重新登入後再送（client.js 會導向登入頁）
            stopKeepQueue('登入已過期，請重新登入', 'error')
            return
          }
          if (err instanceof ApiError && DISCARDABLE_STATUSES.includes(err.status)) {
            // 明確的用戶端錯誤：丟掉這筆操作並記錄，繼續下一筆
            hadError = true
            lastError.value = { message: err.message, at: new Date().toISOString() }
            dropOp(op.opId)
            continue
          }
          // 408、429、5xx、未知錯誤都視為暫時性：保留佇列停止
          stopKeepQueue(err.message || '伺服器暫時無法使用，稍後會自動重試', 'error')
          return
        }
      }
      lastSyncedAt.value = new Date().toISOString()
      writeCache()
      clearRetry() // 佇列清空了，不需要重試計時器
      if (hadError) {
        status.value = 'error'
        // 有操作被丟掉，重抓伺服器資料修正畫面
        await refresh()
      } else {
        status.value = 'idle'
      }
    } finally {
      flushing = false
      inFlightOpId = null
    }
  }

  // 新增或更新一筆收支（樂觀更新）
  async function saveTransaction(data) {
    const id = data.id || uuid()
    const item = {
      invoiceId: null,
      note: '',
      ...data,
      id,
      title: String(data.title ?? '').trim(),
      amount: Math.round(Number(data.amount) || 0),
      createdAt: data.createdAt || new Date().toISOString()
    }
    upsertTransaction(item)
    writeCache()
    enqueue({ kind: 'transaction', action: 'put', id, data: item })
    await flush()
    return item
  }

  async function deleteTransaction(id) {
    transactions.value = transactions.value.filter((t) => t.id !== id)
    writeCache()
    enqueue({ kind: 'transaction', action: 'delete', id })
    await flush()
  }

  // 新增或更新一張發票；新發票本機先算 period、prizeStatus 為 pending，伺服器回來後覆蓋
  async function saveInvoice(data) {
    const id = data.id || uuid()
    const prev = invoices.value.find((i) => i.id === id)
    const number = normalizeInvoiceNumber(data.number)
    const item = {
      seller: '',
      sellerId: '',
      randomCode: '',
      items: [],
      source: 'manual',
      ...prev,
      ...data,
      id,
      number,
      amount: Math.round(Number(data.amount) || 0),
      period: periodOf(data.date),
      prizeStatus: 'pending',
      prizeName: null,
      prizeAmount: 0,
      checkedAt: null,
      createdAt: prev?.createdAt || new Date().toISOString()
    }
    // 編輯時號碼與日期都沒變，就保留原本的對獎結果（和後端行為一致）
    if (prev && prev.number === number && prev.date === data.date) {
      item.period = prev.period
      item.prizeStatus = prev.prizeStatus
      item.prizeName = prev.prizeName
      item.prizeAmount = prev.prizeAmount
      item.checkedAt = prev.checkedAt
    }
    upsertInvoice(item)
    writeCache()
    enqueue({ kind: 'invoice', action: 'put', id, data: item })
    await flush()
    return item
  }

  async function deleteInvoice(id) {
    invoices.value = invoices.value.filter((i) => i.id !== id)
    // 連到這張發票的交易解除關聯（後端刪除時也會做）
    transactions.value = transactions.value.map((t) => (t.invoiceId === id ? { ...t, invoiceId: null } : t))
    writeCache()
    enqueue({ kind: 'invoice', action: 'delete', id })
    await flush()
  }

  // 清掉這個使用者的快取和 outbox（設定頁用，之後會 load() 重抓）
  function clearLocal() {
    const id = userId()
    if (id !== null) {
      localStorage.removeItem(STORAGE_KEYS.cache(id))
      localStorage.removeItem(STORAGE_KEYS.outbox(id))
    }
    transactions.value = []
    invoices.value = []
    outbox.value = []
    lastError.value = null
    loaded.value = false
    clearRetry()
  }

  // 登出時清空記憶體狀態（localStorage 快取保留，重新登入可立即顯示）
  function reset() {
    transactions.value = []
    invoices.value = []
    outbox.value = []
    status.value = 'idle'
    lastSyncedAt.value = null
    lastError.value = null
    loaded.value = false
    clearRetry()
  }

  // 網路恢復時自動把佇列送出去
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      flush()
    })
  }

  return {
    transactions: sortedTransactions,
    invoices: sortedInvoices,
    status,
    pendingCount,
    lastSyncedAt,
    lastError,
    load,
    flush,
    refresh,
    saveTransaction,
    deleteTransaction,
    saveInvoice,
    deleteInvoice,
    clearLocal,
    reset
  }
})
