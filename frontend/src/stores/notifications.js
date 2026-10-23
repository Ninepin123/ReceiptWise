// 通知 store：App 內通知清單（樂觀更新）＋ 瀏覽器系統通知。
// 系統通知優先走 service worker 的 showNotification（Android Chrome
// 不支援 new Notification()）；還沒顯示過的通知 id 存 localStorage，
// 同一個 id 只顯示一次。
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../api/client'

const NOTIFY_PREF_KEY = 'receiptwise-notify' // '1' = 使用者開啟系統通知
const NOTIFIED_IDS_KEY = 'receiptwise-notified-ids' // 已顯示過的通知 id，最多保留 100 筆
const MAX_NOTIFIED_IDS = 100

function readNotifiedIds() {
  try {
    const value = JSON.parse(localStorage.getItem(NOTIFIED_IDS_KEY) || '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function writeNotifiedIds(ids) {
  try {
    // 只保留最新的 100 筆
    localStorage.setItem(NOTIFIED_IDS_KEY, JSON.stringify(ids.slice(-MAX_NOTIFIED_IDS)))
  } catch {
    // localStorage 不可用就略過
  }
}

// 不支援 Notification API 的瀏覽器（如 iOS Safari 非安裝模式）
function initialPermission() {
  try {
    if (typeof Notification === 'undefined') return 'unsupported'
    return Notification.permission || 'default'
  } catch {
    return 'unsupported'
  }
}

export const useNotificationsStore = defineStore('notifications', () => {
  const items = ref([])
  const unreadCount = ref(0)
  const permission = ref(initialPermission())
  const enabled = ref(false)

  try {
    enabled.value = localStorage.getItem(NOTIFY_PREF_KEY) === '1'
  } catch {
    // localStorage 不可用就當作沒開啟
  }

  function persistEnabled() {
    try {
      if (enabled.value) localStorage.setItem(NOTIFY_PREF_KEY, '1')
      else localStorage.removeItem(NOTIFY_PREF_KEY)
    } catch {
      // 略過
    }
  }

  // ---- 瀏覽器系統通知 ----

  // 顯示一則系統通知；任何失敗都安靜略過
  async function showOne(notification) {
    const options = {
      body: notification.body,
      icon: '/pwa-192x192.png',
      tag: `lottery-${notification.id}`
    }
    try {
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        // ready 在沒有任何 SW 註冊時永遠不會 resolve，用 timeout 保險
        const registration = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((_, reject) => setTimeout(() => reject(new Error('sw timeout')), 2500))
        ])
        await registration.showNotification(notification.title, options)
        return
      }
    } catch {
      // 沒有 service worker 就退回 new Notification()
    }
    try {
      new Notification(notification.title, options)
    } catch {
      // 不支援就放棄
    }
  }

  // 把「未讀、lottery_win、還沒顯示過」的通知顯示出來
  function notifyUnreadWins() {
    if (!enabled.value || permission.value !== 'granted') return
    const shown = readNotifiedIds()
    const shownSet = new Set(shown)
    const fresh = items.value.filter(
      (n) => n.type === 'lottery_win' && !n.read && !shownSet.has(n.id)
    )
    if (fresh.length === 0) return
    for (const n of fresh) {
      showOne(n)
      shown.push(n.id)
    }
    writeNotifiedIds(shown)
  }

  // ---- 對外動作 ----

  // 抓通知清單；網路錯誤時安靜失敗（保留原清單）
  async function fetch() {
    try {
      const res = await api.get('/notifications')
      items.value = res?.notifications ?? []
      unreadCount.value = res?.unreadCount ?? items.value.filter((n) => !n.read).length
      notifyUnreadWins()
    } catch {
      // 安靜失敗
    }
  }

  // 標記單則已讀（樂觀更新，失敗還原）
  async function markRead(id) {
    const target = items.value.find((n) => n.id === id)
    if (!target || target.read) return
    target.read = true
    if (unreadCount.value > 0) unreadCount.value -= 1
    try {
      await api.post(`/notifications/${id}/read`)
    } catch {
      target.read = false
      unreadCount.value += 1
    }
  }

  // 全部標記已讀（樂觀更新，失敗還原）
  async function markAllRead() {
    const affected = items.value.filter((n) => !n.read)
    if (affected.length === 0) return
    for (const n of affected) n.read = true
    unreadCount.value = 0
    try {
      await api.post('/notifications/read-all')
    } catch {
      for (const n of affected) n.read = false
      unreadCount.value = affected.length
    }
  }

  // 開啟系統通知：要求瀏覽器權限，允許後才記住偏好
  async function enable() {
    if (permission.value === 'unsupported') return false
    let result = 'default'
    try {
      result = await Notification.requestPermission()
    } catch {
      return false
    }
    permission.value = result || 'default'
    if (permission.value !== 'granted') return false
    enabled.value = true
    persistEnabled()
    // 剛開啟時把現有未讀視為已顯示，避免一口氣跳出成堆舊通知
    const currentIds = items.value
      .filter((n) => n.type === 'lottery_win' && !n.read)
      .map((n) => n.id)
    if (currentIds.length > 0) writeNotifiedIds([...new Set([...readNotifiedIds(), ...currentIds])])
    return true
  }

  function disable() {
    enabled.value = false
    persistEnabled()
  }

  // 登出時清空記憶體狀態（偏好與已顯示 id 是裝置層級，保留）
  function reset() {
    items.value = []
    unreadCount.value = 0
  }

  return {
    items,
    unreadCount,
    permission,
    enabled,
    fetch,
    markRead,
    markAllRead,
    enable,
    disable,
    reset
  }
})
