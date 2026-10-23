import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { registerSW } from 'virtual:pwa-register'
import router from './router'
import App from './App.vue'
import { LEGACY_STORAGE_PREFIX } from './constants'
import './styles/index.css'

// 註冊 service worker（開發模式 devOptions.enabled=false 時為 no-op）
registerSW({ immediate: true })

// 清掉舊版 CloudLedger 展示模式留下的 localStorage key
for (let i = localStorage.length - 1; i >= 0; i--) {
  const key = localStorage.key(i)
  if (key && key.startsWith(LEGACY_STORAGE_PREFIX)) localStorage.removeItem(key)
}

createApp(App).use(createPinia()).use(router).mount('#app')
