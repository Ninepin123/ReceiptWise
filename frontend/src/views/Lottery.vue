<script setup>
import { computed, ref } from 'vue'
import { Trophy, CircleHelp, CheckCircle2, AlertCircle, Save } from 'lucide-vue-next'
import { getInvoices, saveInvoices } from '../api'
const period = ref('115年09-10月')
const special = ref('')
const grand = ref('')
const first = ref('')
const second = ref('')
const third = ref('')
const result = ref(null)
const invoiceRows = ref(getInvoices())
const eligible = computed(() =>
  invoiceRows.value.filter(i => i.date.startsWith('2026-09') || i.date.startsWith('2026-10'))
)
function digits(v) { return String(v || '').replace(/\D/g, '') }
function compare() {
  if (
    ![special.value, grand.value, first.value, second.value, third.value].some(v => digits(v).length)
  ) {
    alert('請至少輸入一組獎號')
    return
  }
  const prizes = [
    { name: '特別獎', num: digits(special.value), amount: 10000000 },
    { name: '特獎', num: digits(grand.value), amount: 2000000 },
    { name: '頭獎', num: digits(first.value), amount: 200000 },
    { name: '二獎', num: digits(second.value), amount: 40000 },
    { name: '三獎', num: digits(third.value), amount: 10000 },
  ].filter(p => p.num)
  const checks = eligible.value.map(inv => {
    const invoiceDigits = digits(inv.number)
    let prize = null
    for (const p of prizes) {
      if (p.num.length >= 3 && invoiceDigits.endsWith(p.num.slice(-3))) {
        prize = {
          ...p,
          amount: p.amount,
          name: p.name + '（末三碼符合，僅供初步比對）',
        }
        break
      }
    }
    return { ...inv, match: prize }
  })
  result.value = checks
}
function mark(inv, status) {
  invoiceRows.value = invoiceRows.value.map(i => i.id === inv.id ? { ...i, status } : i)
  saveInvoices(invoiceRows.value)
  if (result.value) result.value = result.value.map(i => i.id === inv.id ? { ...i, status } : i)
}
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow purple">INVOICE LOTTERY</div>
      <h1>發票獎號核對</h1>
      <p>輸入當期獎號，協助比對已整理的發票。</p>
    </div>
    <span class="feature-tag"><Trophy :size="15" /> 手動核對工具</span>
  </div>
  <div class="notice-strip">
    <span class="notice-icon"><CircleHelp :size="17" /></span>
    <span>獎號需自行從官方公告確認。本工具目前僅做末三碼初步比對，不能判定正式中獎結果。</span>
  </div>
  <div class="lottery-layout">
    <section class="panel lottery-input-panel">
      <div class="panel-heading">
        <div>
          <h3>輸入開獎號碼</h3>
          <p>請依官方公告填入獎號數字</p>
        </div>
      </div>
      <div class="form-field">
        <label>發票期別</label>
        <select v-model="period">
          <option>115年09-10月</option>
          <option>115年07-08月</option>
          <option>115年05-06月</option>
          <option>115年03-04月</option>
          <option>115年01-02月</option>
        </select>
      </div>
      <div class="prize-field special-prize">
        <label>
          <span>特別獎</span>
          <b>NT$ 10,000,000</b>
        </label>
        <input v-model="special" inputmode="numeric" maxlength="8" placeholder="輸入 8 位獎號" />
      </div>
      <div class="prize-field grand-prize">
        <label>
          <span>特獎</span>
          <b>NT$ 2,000,000</b>
        </label>
        <input v-model="grand" inputmode="numeric" maxlength="8" placeholder="輸入 8 位獎號" />
      </div>
      <div class="prize-field first-prize">
        <label>
          <span>頭獎</span>
          <b>NT$ 200,000 起</b>
        </label>
        <input v-model="first" inputmode="numeric" maxlength="8" placeholder="輸入頭獎號碼（可輸入一組）" />
      </div>
      <div class="prize-field other-prize">
        <label>
          <span>二獎末碼（選填）</span>
          <b>NT$ 40,000</b>
        </label>
        <input v-model="second" inputmode="numeric" maxlength="8" placeholder="選填" />
      </div>
      <div class="prize-field other-prize">
        <label>
          <span>三獎末碼（選填）</span>
          <b>NT$ 10,000</b>
        </label>
        <input v-model="third" inputmode="numeric" maxlength="8" placeholder="選填" />
      </div>
      <button
        class="btn-primary full-button"
        @click="compare"
      ><Trophy :size="17" /> 開始初步比對</button>
    </section>
    <section class="panel lottery-results">
      <div class="panel-heading">
        <div>
          <h3>比對結果</h3>
          <p>{{ period }} · 本機發票</p>
        </div>
        <span class="result-count">{{ result ? result.length : eligible.length }} 張</span>
      </div>
      <div v-if="!result" class="lottery-empty">
        <div class="lottery-empty-icon">
          <Trophy :size="30" />
        </div>
        <b>準備好核對你的發票了嗎？</b>
        <p>輸入官方獎號後，按下「開始初步比對」。</p>
        <small>目前有 {{ eligible.length }} 張 9–10 月發票可供比對</small>
      </div>
      <div v-else class="lottery-result-list">
        <div v-for="inv in result" :key="inv.id" class="lottery-result-row">
          <div class="result-status-icon" :class="inv.match ? 'matched' : 'unmatched'">
            <CheckCircle2 v-if="inv.match" :size="20" />
            <AlertCircle v-else :size="20" />
          </div>
          <div class="result-main">
            <b>{{ inv.seller || '未填寫店家' }}</b>
            <span>{{ inv.number }} · {{ inv.date }}</span>
            <small v-if="inv.match">{{ inv.match.name }}，請至官方公告再次確認</small>
            <small v-else>目前輸入的獎號未符合初步末三碼比對</small>
          </div>
          <div class="result-actions">
            <b>{{ inv.match ? '待確認' : '未符合' }}</b>
            <button
              v-if="inv.match"
              class="mini-save"
              @click="mark(inv, '待確認')"
            ><Save :size="13" /> 標記</button>
          </div>
        </div>
        <div v-if="!result.length" class="empty-state">此期別沒有發票資料。</div>
        <button class="btn-secondary full-button rerun" @click="compare">重新比對</button>
      </div>
      <div class="lottery-disclaimer">此功能僅供整理與初步比對。中獎規則可能包含完整號碼及末位數對獎，請以財政部官方公告為準。</div>
    </section>
  </div>
</template>
