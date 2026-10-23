// 對獎 store：獎號清單、下次開獎與「立即對獎」。
// 錯誤一律存進 error（中文訊息），不往外丟例外，頁面直接顯示。
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../api/client'
import { useLedgerStore } from './ledger'
import { useNotificationsStore } from './notifications'

export const useLotteryStore = defineStore('lottery', () => {
  const draws = ref([]) // 期別獎號，新到舊
  const nextDraw = ref(null) // { period, label, drawDate }
  const lastFetchedAt = ref(null)
  const loading = ref(false)
  const checking = ref(false)
  const error = ref(null)
  const lastCheck = ref(null) // { at, checked, newWins, summary }

  // 抓獎號；502（抓不到 RSS）或網路錯誤時只設 error
  async function fetchDraws() {
    loading.value = true
    error.value = null
    try {
      const res = await api.get('/lottery/draws')
      const previousFetchedAt = lastFetchedAt.value
      draws.value = res?.draws ?? []
      nextDraw.value = res?.nextDraw ?? null
      lastFetchedAt.value = res?.lastFetchedAt ?? null
      // 伺服器剛抓到新獎號時會順便對獎，要重抓發票與通知才看得到結果
      if (lastFetchedAt.value !== previousFetchedAt) {
        await Promise.allSettled([useLedgerStore().refresh(), useNotificationsStore().fetch()])
      }
    } catch (err) {
      error.value = err.message || '目前無法取得統一發票獎號，請稍後再試'
    } finally {
      loading.value = false
    }
  }

  // 立即對獎：成功後重抓發票（更新對獎結果）與通知（中獎通知）
  async function checkNow() {
    if (checking.value) return null
    checking.value = true
    try {
      const res = await api.post('/lottery/check')
      lastCheck.value = {
        at: new Date().toISOString(),
        checked: res?.checked ?? 0,
        newWins: res?.newWins ?? [],
        summary: res?.summary ?? { won: 0, notWon: 0, pending: 0 }
      }
      const ledger = useLedgerStore()
      const notifications = useNotificationsStore()
      await Promise.allSettled([ledger.refresh(), notifications.fetch()])
      return lastCheck.value
    } catch (err) {
      error.value = err.message || '對獎失敗，請稍後再試'
      return null
    } finally {
      checking.value = false
    }
  }

  return {
    draws,
    nextDraw,
    lastFetchedAt,
    loading,
    checking,
    error,
    lastCheck,
    fetchDraws,
    checkNow
  }
})
