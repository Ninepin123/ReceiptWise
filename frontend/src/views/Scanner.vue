<script setup>
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useRouter } from 'vue-router'
import { ScanLine, Camera, Keyboard, ReceiptText, ArrowRight, CircleHelp } from 'lucide-vue-next'
import { getInvoices, saveInvoices } from '../api'

const router = useRouter()
const notice = ref('')
const form = ref({
  number: '',
  date: new Date().toISOString().slice(0,10),
  amount: '',
  randomCode: '',
  seller: ''
})

function save() {
  if (!form.value.number.trim() || !form.value.date || Number(form.value.amount) < 0) {
    notice.value = '請填寫發票號碼、日期與有效金額。'
    return
  }
  const rows = getInvoices()
  rows.unshift({
    ...form.value,
    id: Date.now(),
    number: form.value.number.trim().toUpperCase(),
    amount: Number(form.value.amount),
    status: '待核對'
  })
  saveInvoices(rows)
  notice.value = '已儲存到本機發票清單。'
  form.value = {
    number: '',
    date: new Date().toISOString().slice(0,10),
    amount: '',
    randomCode: '',
    seller: ''
  }
}
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow purple">QUICK CAPTURE</div>
      <h1>QR 掃描輔助</h1>
      <p>快速整理電子發票資訊，也可手動補登紙本收據。</p>
    </div>
  </div>
  <div class="scanner-layout">
    <section class="panel scanner-main">
      <div class="scanner-title-icon"><ScanLine :size="24" /></div>
      <h2>掃描發票 QR Code</h2>
      <p class="scanner-intro">目前版本先提供掃描流程介面與手動輸入；尚未啟用相機掃描或自動解析 QR Code。</p>
      <div class="scan-placeholder">
        <div class="scan-frame">
          <span class="corner tl"></span>
          <span class="corner tr"></span>
          <span class="corner bl"></span>
          <span class="corner br"></span>
          <ReceiptText :size="44" stroke-width="1.2" />
        </div>
        <b>相機掃描功能尚未連接</b>
        <span>可先使用下方手動輸入表單</span>
      </div>
      <div class="scan-tips">
        <div>
          <Camera :size="18" />
          <span>正式版本可在 HTTPS 或 localhost 環境申請相機權限。</span>
        </div>
        <div>
          <CircleHelp :size="18" />
          <span>請核對發票號碼、日期、隨機碼與金額是否正確。</span>
        </div>
      </div>
    </section>
    <section class="panel scanner-form-panel">
      <div class="panel-heading">
        <div>
          <h3><Keyboard :size="18" /> 手動輸入發票</h3>
          <p>適用於紙本收據或無法掃描的發票</p>
        </div>
      </div>
      <form class="form-stack" @submit.prevent="save">
        <div class="form-field">
          <label>發票號碼 *</label>
          <input v-model="form.number" required placeholder="例如：AB-12345678" />
        </div>
        <div class="form-field">
          <label>開立日期 *</label>
          <input v-model="form.date" required type="date" />
        </div>
        <div class="form-field">
          <label>消費金額（NT$）*</label>
          <input v-model="form.amount" required min="0" type="number" placeholder="輸入金額" />
        </div>
        <div class="form-field">
          <label>隨機碼</label>
          <input v-model="form.randomCode" maxlength="4" placeholder="4 位數（選填）" />
        </div>
        <div class="form-field">
          <label>店家名稱</label>
          <input v-model="form.seller" placeholder="選填" />
        </div>
        <p v-if="notice" class="inline-notice">{{ notice }}</p>
        <button class="btn-primary full-button" type="submit">儲存發票 <ArrowRight :size="16" /></button>
        <RouterLink class="btn-secondary full-button centered" to="/invoices">前往發票清單</RouterLink>
      </form>
    </section>
  </div>
</template>
