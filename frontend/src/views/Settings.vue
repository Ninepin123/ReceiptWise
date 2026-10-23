<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useLedgerStore } from '../stores/ledger'
import { useNotificationsStore } from '../stores/notifications'
import {
  ShieldCheck,
  CloudCog,
  RefreshCw,
  RotateCcw,
  LogOut,
  BellRing,
  Bell,
  Info
} from 'lucide-vue-next'

const auth = useAuthStore()
const ledger = useLedgerStore()
const notifications = useNotificationsStore()
const router = useRouter()
const syncing = ref(false)
const requesting = ref(false)

// 開啟系統通知：要求瀏覽器權限（拒絕時會顯示被封鎖的提示）
async function enableNotify() {
  if (requesting.value) return
  requesting.value = true
  try {
    await notifications.enable()
  } finally {
    requesting.value = false
  }
}

const displayName = computed(() => auth.user?.displayName || '使用者')
const email = computed(() => auth.user?.email || '')
const createdAt = computed(() =>
  auth.user?.createdAt ? new Date(auth.user.createdAt).toLocaleString('zh-TW') : '—'
)

const statusChip = computed(
  () =>
    ({
      idle: { text: '已同步', cls: '' },
      syncing: { text: '同步中', cls: 'pending' },
      offline: { text: '離線', cls: 'pending' },
      error: { text: '同步錯誤', cls: 'error' }
    })[ledger.status]
)

const lastSyncText = computed(() =>
  ledger.lastSyncedAt ? new Date(ledger.lastSyncedAt).toLocaleString('zh-TW') : '尚未同步'
)

async function syncNow() {
  if (syncing.value) return
  syncing.value = true
  try {
    await ledger.flush()
    await ledger.refresh()
  } finally {
    syncing.value = false
  }
}

function clearCache() {
  const message =
    ledger.pendingCount > 0
      ? `有 ${ledger.pendingCount} 筆資料尚未同步，清除本機快取會遺失這些修改。確定要清除嗎？`
      : '確定要清除本機快取嗎？清除後會重新從伺服器下載資料。'
  if (!confirm(message)) return
  ledger.clearLocal()
  ledger.load()
}

function logout() {
  if (ledger.pendingCount > 0) {
    const ok = confirm(`有 ${ledger.pendingCount} 筆資料尚未同步，登出會遺失這些修改。確定要登出嗎？`)
    if (!ok) return
  }
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow purple">PREFERENCES</div>
      <h1>系統設定</h1>
      <p>管理帳號、資料同步與本機資料。</p>
    </div>
  </div>
  <div class="settings-layout">
    <section class="panel settings-panel">
      <div class="panel-heading">
        <div>
          <h3>帳號資訊</h3>
          <p>目前登入的帳號</p>
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-icon lavender"><ShieldCheck /></div>
        <div class="setting-copy">
          <b>顯示名稱</b>
          <span>顯示在側邊欄與頂部列</span>
        </div>
        <strong>{{ displayName }}</strong>
      </div>
      <div class="setting-row">
        <div class="setting-icon mint"><ShieldCheck /></div>
        <div class="setting-copy">
          <b>Email</b>
          <span>登入帳號</span>
        </div>
        <strong>{{ email }}</strong>
      </div>
      <div class="setting-row">
        <div class="setting-icon peach"><ShieldCheck /></div>
        <div class="setting-copy">
          <b>註冊日期</b>
          <span>帳號建立的時間</span>
        </div>
        <strong>{{ createdAt }}</strong>
      </div>
    </section>

    <section class="panel settings-panel">
      <div class="panel-heading">
        <div>
          <h3>資料同步</h3>
          <p>收支與發票資料的同步狀態</p>
        </div>
        <span class="status-chip" :class="statusChip.cls">{{ statusChip.text }}</span>
      </div>
      <div class="setting-row">
        <div class="setting-icon lavender"><CloudCog /></div>
        <div class="setting-copy">
          <b>同步狀態</b>
          <span>待同步 {{ ledger.pendingCount }} 筆 · 上次同步：{{ lastSyncText }}</span>
        </div>
        <button class="btn-secondary" :disabled="syncing" @click="syncNow">
          <RefreshCw :size="14" /> {{ syncing ? '同步中...' : '立即同步' }}
        </button>
      </div>
      <div v-if="ledger.lastError" class="settings-warning">
        <Info :size="18" />
        <p>最近一次同步錯誤：{{ ledger.lastError.message }}（{{ new Date(ledger.lastError.at).toLocaleString('zh-TW') }}）</p>
      </div>
    </section>

    <section class="panel settings-panel settings-notify">
      <div class="panel-heading">
        <div>
          <h3>中獎通知</h3>
          <p>開獎後自動通知你中獎的發票</p>
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-icon peach"><BellRing /></div>
        <div class="setting-copy">
          <b>系統通知</b>
          <span>開獎後自動對獎，中獎時在 App 內通知；開啟後，網頁開著時也會跳出系統通知。</span>
        </div>
        <!-- 依瀏覽器權限狀態顯示不同控制 -->
        <template v-if="notifications.permission === 'denied'">
          <span class="notify-hint">瀏覽器已封鎖通知，請到瀏覽器網站設定中允許</span>
        </template>
        <template v-else-if="notifications.permission === 'unsupported'">
          <span class="notify-hint">此瀏覽器不支援系統通知，安裝到主畫面後再試試</span>
        </template>
        <template v-else-if="notifications.enabled && notifications.permission === 'granted'">
          <span class="status-chip">已開啟</span>
          <button class="btn-secondary" @click="notifications.disable()">關閉</button>
        </template>
        <template v-else>
          <button class="btn-secondary" :disabled="requesting" @click="enableNotify">
            <BellRing :size="14" /> {{ requesting ? '處理中…' : '開啟系統通知' }}
          </button>
        </template>
      </div>
      <div class="setting-row">
        <div class="setting-icon mint"><Bell /></div>
        <div class="setting-copy">
          <b>App 內通知</b>
          <span>頂部列鈴鐺的中獎通知，一律開啟。</span>
        </div>
        <span class="status-chip">已開啟</span>
      </div>
    </section>

    <section class="panel settings-panel">
      <div class="panel-heading">
        <div>
          <h3>本機資料與登出</h3>
          <p>清除這個瀏覽器的快取，或登出帳號</p>
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-icon peach"><RotateCcw /></div>
        <div class="setting-copy">
          <b>清除本機快取</b>
          <span>刪除存在此瀏覽器的收支與發票快取，下次載入時重新從伺服器下載。</span>
        </div>
        <button class="btn-secondary" @click="clearCache">清除本機快取</button>
      </div>
      <div class="setting-row">
        <div class="setting-icon lavender"><LogOut /></div>
        <div class="setting-copy">
          <b>登出</b>
          <span>結束這個裝置上的登入狀態。</span>
        </div>
        <button class="btn-secondary logout-button" @click="logout"><LogOut :size="14" /> 登出</button>
      </div>
    </section>
  </div>
</template>
