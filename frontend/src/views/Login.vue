<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { Wallet, ShieldCheck, ChartNoAxesCombined, ReceiptText } from 'lucide-vue-next'

const username = ref('')
const password = ref('')
const error = ref('')
const router = useRouter()
const auth = useAuthStore()

function submit() {
  if (!username.value.trim() || !password.value.trim()) {
    error.value = '請輸入帳號與密碼'
    return
  }
  auth.login(username.value)
  router.push('/')
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
          <h2>歡迎回來</h2>
          <p>登入你的雲端記帳工作空間</p>
        </div>
        <form @submit.prevent="submit">
          <label for="username">帳號</label>
          <input id="username" v-model="username" autocomplete="username" placeholder="輸入任意示範帳號" />
          <label for="password">密碼</label>
          <input
            id="password"
            v-model="password"
            type="password"
            autocomplete="current-password"
            placeholder="輸入任意示範密碼"
          />
          <p v-if="error" class="error-text">{{ error }}</p>
          <button class="btn-primary login-submit" type="submit">登入工作空間 <span>→</span></button>
        </form>
        <div class="demo-note">
          <span>ⓘ</span>
          <p><b>前端展示模式</b><br />目前不會驗證真實帳號；輸入任意非空白帳號與密碼即可體驗介面。</p>
        </div>
        <div class="login-copyright">© 2026 CloudLedger · 智慧記帳，從容生活</div>
      </div>
    </section>
  </div>
</template>
