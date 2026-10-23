<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { NetworkError } from '../api/client'
import { Wallet, ShieldCheck, ChartNoAxesCombined, ReceiptText } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const mode = ref('login') // 'login' | 'register'
const displayName = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const error = ref('')
const submitting = ref(false)

const heading = computed(() =>
  mode.value === 'login'
    ? { title: '歡迎回來', sub: '登入你的雲端記帳工作空間' }
    : { title: '建立帳號', sub: '註冊後即可跨裝置同步記帳資料' }
)

function switchMode(next) {
  mode.value = next
  error.value = ''
}

async function submit() {
  error.value = ''
  if (!email.value.trim() || !password.value) {
    error.value = '請輸入 email 與密碼'
    return
  }
  if (mode.value === 'register') {
    if (password.value.length < 8) {
      error.value = '密碼至少需要 8 個字元'
      return
    }
    if (password.value !== confirmPassword.value) {
      error.value = '兩次輸入的密碼不一致'
      return
    }
  }
  submitting.value = true
  try {
    if (mode.value === 'login') {
      await auth.login(email.value.trim(), password.value)
    } else {
      await auth.register(email.value.trim(), password.value, displayName.value.trim())
    }
    const redirect = route.query.redirect
    router.push(typeof redirect === 'string' && redirect.startsWith('/') ? redirect : '/')
  } catch (err) {
    error.value =
      err instanceof NetworkError ? '無法連線到伺服器，請稍後再試' : err.message || '發生錯誤，請稍後再試'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login-layout">
    <section class="login-promo">
      <router-link to="/login" class="brand brand-light">
        <span class="brand-mark"><Wallet :size="22" /></span>
        <span><b>雲帳</b><small>CloudLedger</small></span>
      </router-link>
      <div class="promo-copy">
        <div class="eyebrow">SMART FINANCE, SIMPLIFIED</div>
        <h1>讓每一筆收支，<br />都清晰有序。</h1>
        <p>整合日常記帳與電子發票，輕鬆掌握你的財務全貌。</p>
      </div>
      <div class="promo-features">
        <div>
          <ChartNoAxesCombined />
          <span><b>財務一目了然</b><small>月度趨勢與支出分類分析</small></span>
        </div>
        <div>
          <ReceiptText />
          <span><b>發票集中管理</b><small>收據整理與獎號核對輔助</small></span>
        </div>
        <div>
          <ShieldCheck />
          <span><b>簡潔直覺體驗</b><small>專為日常快速記帳設計</small></span>
        </div>
      </div>
      <div class="promo-decoration deco-one"></div>
      <div class="promo-decoration deco-two"></div>
    </section>
    <section class="login-form-side">
      <div class="login-form-wrap">
        <div class="form-heading">
          <div class="mobile-login-mark"><Wallet /></div>
          <h2>{{ heading.title }}</h2>
          <p>{{ heading.sub }}</p>
        </div>
        <div class="login-tabs">
          <button type="button" :class="{ active: mode === 'login' }" @click="switchMode('login')">登入</button>
          <button type="button" :class="{ active: mode === 'register' }" @click="switchMode('register')">註冊</button>
        </div>
        <form @submit.prevent="submit">
          <template v-if="mode === 'register'">
            <label for="displayName">顯示名稱</label>
            <input
              id="displayName"
              v-model="displayName"
              autocomplete="nickname"
              maxlength="50"
              placeholder="選填"
            />
          </template>
          <label for="email">Email</label>
          <input
            id="email"
            v-model="email"
            type="email"
            autocomplete="username"
            placeholder="you@example.com"
          />
          <label for="password">密碼</label>
          <input
            id="password"
            v-model="password"
            type="password"
            :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
            placeholder="至少 8 個字元"
          />
          <template v-if="mode === 'register'">
            <label for="confirmPassword">確認密碼</label>
            <input
              id="confirmPassword"
              v-model="confirmPassword"
              type="password"
              autocomplete="new-password"
              placeholder="再輸入一次密碼"
            />
          </template>
          <p v-if="error" class="error-text">{{ error }}</p>
          <button class="btn-primary login-submit" type="submit" :disabled="submitting">
            {{ submitting ? '處理中...' : mode === 'login' ? '登入工作空間' : '建立帳號' }}
            <span v-if="!submitting">→</span>
          </button>
        </form>
        <div class="login-copyright">© 2026 CloudLedger · 智慧記帳，從容生活</div>
      </div>
    </section>
  </div>
</template>
