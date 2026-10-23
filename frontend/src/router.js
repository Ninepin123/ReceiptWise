import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from './stores/auth'

// 頁面都用 lazy import，減少初始載入大小
const routes = [
  { path: '/login', name: 'login', component: () => import('./views/Login.vue'), meta: { public: true } },
  { path: '/', name: 'dashboard', component: () => import('./views/Dashboard.vue') },
  { path: '/transactions', name: 'transactions', component: () => import('./views/Transactions.vue') },
  { path: '/invoices', name: 'invoices', component: () => import('./views/Invoices.vue') },
  { path: '/scanner', name: 'scanner', component: () => import('./views/Scanner.vue') },
  { path: '/lottery', name: 'lottery', component: () => import('./views/Lottery.vue') },
  { path: '/settings', name: 'settings', component: () => import('./views/Settings.vue') }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (!to.meta.public && !auth.isLoggedIn) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.name === 'login' && auth.isLoggedIn) return { name: 'dashboard' }
})

export default router
