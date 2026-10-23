<script setup>
// 頂部列通知鈴鐺：未讀數紅點 + 下拉通知面板。
// 點通知 → 標已讀並前往對獎頁；點外面或按 Esc 關閉。
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Bell, BellOff, Trophy } from 'lucide-vue-next'
import { useNotificationsStore } from '../stores/notifications'

const notifications = useNotificationsStore()
const router = useRouter()
const open = ref(false)
const wrap = ref(null)

// 未讀數超過 9 顯示 9+
const badge = computed(() =>
  notifications.unreadCount > 9 ? '9+' : String(notifications.unreadCount)
)

function toggle() {
  open.value = !open.value
}

// 相對時間，如「3 小時前」
function timeAgo(iso) {
  const time = new Date(iso).getTime()
  if (!time) return ''
  const minutes = Math.floor((Date.now() - time) / 60000)
  if (minutes < 1) return '剛剛'
  if (minutes < 60) return `${minutes} 分鐘前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小時前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(iso).toLocaleDateString('zh-TW')
}

function openNotification(item) {
  if (!item.read) notifications.markRead(item.id)
  open.value = false
  router.push('/lottery')
}

function onDocClick(event) {
  if (open.value && wrap.value && !wrap.value.contains(event.target)) open.value = false
}

function onKey(event) {
  if (event.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div ref="wrap" class="bell-wrap">
    <button type="button" class="bell-button" :class="{ open }" title="通知" @click="toggle">
      <Bell :size="18" />
      <span v-if="notifications.unreadCount > 0" class="bell-badge">{{ badge }}</span>
    </button>
    <div v-if="open" class="bell-panel">
      <div class="bell-panel-head">
        <b>通知</b>
        <button
          v-if="notifications.unreadCount > 0"
          type="button"
          class="bell-read-all"
          @click="notifications.markAllRead()"
        >
          全部已讀
        </button>
      </div>
      <div v-if="notifications.items.length" class="bell-list">
        <button
          v-for="item in notifications.items"
          :key="item.id"
          type="button"
          class="bell-item"
          :class="{ unread: !item.read }"
          @click="openNotification(item)"
        >
          <span class="bell-item-icon"><Trophy :size="15" /></span>
          <span class="bell-item-main">
            <span class="bell-item-title">{{ item.title }}</span>
            <span class="bell-item-body">{{ item.body }}</span>
            <span class="bell-item-time">{{ timeAgo(item.createdAt) }}</span>
          </span>
        </button>
      </div>
      <div v-else class="bell-empty">
        <span class="bell-empty-icon"><BellOff :size="19" /></span>
        目前沒有通知
      </div>
    </div>
  </div>
</template>
