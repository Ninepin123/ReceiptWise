<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { useLedgerStore } from './stores/ledger'
import { useNotificationsStore } from './stores/notifications'
import SyncStatus from './components/SyncStatus.vue'
import NotificationBell from './components/NotificationBell.vue'
import {
  LayoutDashboard,
  ArrowLeftRight,
  ReceiptText,
  ScanLine,
  Trophy,
  Settings,
  Wallet,
  LogOut,
  X
} from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const ledger = useLedgerStore()
const notifications = useNotificationsStore()

// 側邊欄導覽項目；mobile 是手機版底部導覽的順序（1–5），沒有 mobile 的項目手機版不顯示
const navItems = [
  { label: '總覽儀表板', short: '總覽', to: '/', icon: LayoutDashboard, mobile: 1 },
  { label: '收支管理', short: '收支', to: '/transactions', icon: ArrowLeftRight, mobile: 2 },
  { label: '電子發票', short: '發票', to: '/invoices', icon: ReceiptText, mobile: 4 },
  { label: 'QR 掃描輔助', short: '掃描', to: '/scanner', icon: ScanLine, mobile: 3 },
  { label: '發票獎號核對', short: '對獎', to: '/lottery', icon: Trophy, mobile: 5 },
  { label: '系統設定', short: '設定', to: '/settings', icon: Settings }
]

// 手機版底部導覽 5 格，掃描放中間（mobile === 3）
const mobileNavItems = navItems.filter((i) => i.mobile).sort((a, b) => a.mobile - b.mobile)
const SCAN_ORDER = 3

const isLogin = computed(() => route.name === 'login')
const breadcrumbLabel = computed(
  () => navItems.find((n) => n.to === route.path)?.label || '總覽儀表板'
)
const displayName = computed(() => auth.user?.displayName || auth.user?.email || '使用者')
const initial = computed(() => displayName.value.slice(0, 1).toUpperCase())
const email = computed(() => auth.user?.email || '')

// ---- 中獎橫幅：有未讀中獎通知時顯示，關閉只隱藏到下次有新通知 ----
const bannerDismissedId = ref(0)
const unreadWins = computed(() =>
  notifications.items.filter((n) => n.type === 'lottery_win' && !n.read)
)
const latestUnreadId = computed(() => unreadWins.value.reduce((max, n) => Math.max(max, n.id), 0))
const showWinBanner = computed(
  () => auth.isLoggedIn && unreadWins.value.length > 0 && latestUnreadId.value > bannerDismissedId.value
)

function dismissBanner() {
  bannerDismissedId.value = latestUnreadId.value
}

// ---- 通知輪詢：頁面可見時每 15 分鐘再抓一次 ----
// 必須宣告在下面 immediate watch 之前，否則第一次執行會碰到 TDZ 錯誤
const NOTIFY_INTERVAL = 15 * 60 * 1000
let notifyTimer = null
let lastNotifyFetch = 0

async function pollNotifications() {
  if (!auth.isLoggedIn || document.visibilityState !== 'visible') return
  lastNotifyFetch = Date.now()
  await notifications.fetch()
}

function onVisible() {
  // 回到前景時，距離上次抓取超過 15 分鐘就補抓一次
  if (document.visibilityState === 'visible' && Date.now() - lastNotifyFetch >= NOTIFY_INTERVAL) {
    pollNotifications()
  }
}

function startNotifyPolling() {
  stopNotifyPolling()
  lastNotifyFetch = Date.now()
  notifications.fetch()
  notifyTimer = setInterval(pollNotifications, NOTIFY_INTERVAL)
  document.addEventListener('visibilitychange', onVisible)
}

function stopNotifyPolling() {
  if (notifyTimer) clearInterval(notifyTimer)
  notifyTimer = null
  document.removeEventListener('visibilitychange', onVisible)
}

// 登入後載入帳本（含重新整理時），登出時清空記憶體狀態；
// 同時抓一次通知，之後頁面可見時每 15 分鐘再抓一次
watch(
  () => auth.isLoggedIn,
  (loggedIn) => {
    if (loggedIn) {
      ledger.load()
      // 順便更新使用者資料；token 失效時 client 會統一導向登入頁
      auth.fetchMe().catch(() => {})
      startNotifyPolling()
    } else {
      ledger.reset()
      stopNotifyPolling()
      notifications.reset()
      bannerDismissedId.value = 0
    }
  },
  { immediate: true }
)

onBeforeUnmount(stopNotifyPolling)

async function logout() {
  if (ledger.pendingCount > 0) {
    const ok = confirm(`有 ${ledger.pendingCount} 筆資料尚未同步，下次用同一個帳號登入時會再送出。確定要登出嗎？`)
    if (!ok) return
  }
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <div v-if="isLogin" class="login-shell">
    <router-view />
  </div>
  <div v-else class="app-shell">
    <aside class="sidebar">
      <router-link to="/" class="brand">
        <span class="brand-mark"><Wallet :size="22" /></span>
        <span><b>雲帳</b><small>CloudLedger</small></span>
      </router-link>
      <div class="workspace-label">工作空間</div>
      <!-- 電腦版側邊欄：6 項 -->
      <nav class="nav-list desktop-nav">
        <router-link
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          :class="{ active: route.path === item.to }"
        >
          <component :is="item.icon" :size="19" /><span>{{ item.label }}</span>
        </router-link>
      </nav>
      <!-- 手機版底部導覽：5 項，掃描是中間凸起主按鈕 -->
      <nav class="nav-list mobile-nav">
        <router-link
          v-for="item in mobileNavItems"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          :class="{ active: route.path === item.to, 'nav-scan': item.mobile === SCAN_ORDER }"
        >
          <span v-if="item.mobile === SCAN_ORDER" class="scan-fab">
            <component :is="item.icon" :size="20" />
          </span>
          <component v-else :is="item.icon" :size="19" />
          <span>{{ item.short }}</span>
        </router-link>
      </nav>
      <div class="sidebar-bottom">
        <router-link to="/settings" class="profile-link" title="系統設定">
          <div class="profile-avatar">{{ initial }}</div>
          <div class="profile-copy">
            <b>{{ displayName }}</b>
            <small>{{ email }}</small>
          </div>
        </router-link>
        <button class="icon-button" title="登出" @click="logout">
          <LogOut :size="17" />
        </button>
      </div>
    </aside>
    <main class="main-area">
      <header class="topbar">
        <div class="mobile-brand"><Wallet :size="20" /> 雲帳</div>
        <div class="breadcrumb">工作空間 <span>/</span> {{ breadcrumbLabel }}</div>
        <div class="topbar-right">
          <SyncStatus />
          <div class="topbar-actions"><NotificationBell /></div>
          <router-link to="/settings" class="top-avatar-link" title="系統設定">
            <div class="top-avatar">{{ initial }}</div>
          </router-link>
        </div>
      </header>
      <!-- 中獎橫幅：有未讀中獎通知時顯示 -->
      <router-link v-if="showWinBanner" to="/lottery" class="win-banner">
        <span class="win-banner-text">🎉 恭喜！你有 {{ unreadWins.length }} 張發票中獎，前往查看</span>
        <span class="win-banner-close" role="button" title="關閉" @click.prevent="dismissBanner">
          <X :size="15" />
        </span>
      </router-link>
      <section class="page-content"><router-view /></section>
      <footer class="footer-note">雲帳 CloudLedger <span>·</span> 資料已同步到雲端</footer>
    </main>
  </div>
</template>
