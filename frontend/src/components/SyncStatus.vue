<script setup>
// 頂部列的同步狀態元件：已同步 / 同步中 / 離線待同步 / 同步錯誤，點擊立即同步。
import { computed } from 'vue'
import { useLedgerStore } from '../stores/ledger'

const ledger = useLedgerStore()

const view = computed(() => {
  if (ledger.status === 'syncing') return { cls: 'syncing', text: '同步中' }
  if (ledger.status === 'offline') return { cls: 'offline', text: `離線 · ${ledger.pendingCount} 筆待同步` }
  if (ledger.status === 'error') {
    const pending = ledger.pendingCount > 0 ? ` · ${ledger.pendingCount} 筆待同步` : ''
    return { cls: 'error', text: `同步失敗${pending}` }
  }
  if (ledger.pendingCount > 0) return { cls: 'offline', text: `${ledger.pendingCount} 筆待同步` }
  return { cls: 'idle', text: '已同步' }
})

// 錯誤時 hover 顯示 lastError.message，平常顯示提示
const hint = computed(() =>
  ledger.status === 'error' && ledger.lastError ? ledger.lastError.message : '點擊立即同步'
)

async function resync() {
  if (ledger.status === 'syncing') return
  await ledger.flush()
  await ledger.refresh()
}
</script>

<template>
  <button type="button" class="sync-pill" :class="view.cls" :title="hint" @click="resync">
    <span class="sync-dot"></span>{{ view.text }}
  </button>
</template>
