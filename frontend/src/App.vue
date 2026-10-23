<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'
import {
  LayoutDashboard,
  ArrowLeftRight,
  ReceiptText,
  ScanLine,
  Trophy,
  Settings,
  Wallet,
  LogOut,
  Menu
} from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

// 側邊欄導覽項目
const navItems = [
  { label: '總覽儀表板', to: '/', icon: LayoutDashboard },
  { label: '收支管理', to: '/transactions', icon: ArrowLeftRight },
  { label: '電子發票', to: '/invoices', icon: ReceiptText },
  { label: 'QR 掃描輔助', to: '/scanner', icon: ScanLine },
  { label: '發票獎號核對', to: '/lottery', icon: Trophy },
  { label: '系統設定', to: '/settings', icon: Settings },
]

const isLogin = computed(() => route.name === 'login')

function logout() {
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
      <nav class="nav-list">
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
      <div class="sidebar-bottom">
        <div class="profile-avatar">{{ (auth.user || '示').slice(0, 1).toUpperCase() }}</div>
        <div class="profile-copy">
          <b>{{ auth.user || '示範使用者' }}</b>
          <small>本機展示模式</small>
        </div>
        <button class="icon-button" title="登出" @click="logout">
          <LogOut :size="17" />
        </button>
      </div>
    </aside>
    <main class="main-area">
      <header class="topbar">
        <div class="mobile-brand"><Wallet :size="20" /> 雲帳</div>
        <div class="breadcrumb">工作空間 <span>/</span> {{
          navItems.find(n => n.to === route.path)?.label || '總覽儀表板'
        }}</div>
        <div class="topbar-right">
          <span class="demo-pill"><span></span> 前端展示模式</span>
          <div class="top-avatar">{{ (auth.user || '示').slice(0, 1).toUpperCase() }}</div>
        </div>
      </header>
      <section class="page-content"><router-view /></section>
      <footer class="footer-note">雲帳 CloudLedger <span>•</span> 前端展示版 · 資料保存在此瀏覽器</footer>
    </main>
  </div>
</template>
