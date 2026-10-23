import { createRouter, createWebHistory } from 'vue-router'
import Login from './views/Login.vue'
import Dashboard from './views/Dashboard.vue'
import Transactions from './views/Transactions.vue'
import Invoices from './views/Invoices.vue'
import Scanner from './views/Scanner.vue'
import Lottery from './views/Lottery.vue'
import Settings from './views/Settings.vue'

const routes = [
  { path: '/login', name: 'login', component: Login, meta: { public: true } },
  { path: '/', name: 'dashboard', component: Dashboard },
  { path: '/transactions', name: 'transactions', component: Transactions },
  { path: '/invoices', name: 'invoices', component: Invoices },
  { path: '/scanner', name: 'scanner', component: Scanner },
  { path: '/lottery', name: 'lottery', component: Lottery },
  { path: '/settings', name: 'settings', component: Settings },
]
const router = createRouter({
  history: createWebHistory(),
  routes
})
router.beforeEach((to) => {
  const loggedIn = localStorage.getItem('cloudledger-demo-user')
  if (!to.meta.public && !loggedIn) return { name: 'login' }
  if (to.name === 'login' && loggedIn) return { name: 'dashboard' }
})
export default router
