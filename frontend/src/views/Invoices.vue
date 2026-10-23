<script setup>
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { Plus, Search, Pencil, Trash2, X, ReceiptText, ArrowRight, Trophy } from 'lucide-vue-next'
import { useLedgerStore } from '../stores/ledger'
import { money, formatInvoiceNumber, normalizeInvoiceNumber, isValidInvoiceNumber } from '../utils/format'
import { drawDate, periodOf, todayInTaipei } from '../utils/period'

const ledger = useLedgerStore()
const query = ref('')
const showForm = ref(false)
const editingId = ref(null)
const formError = ref('')
const form = ref(blank())

function blank() {
  return {
    number: '',
    date: todayInTaipei(),
    amount: '',
    seller: '',
    randomCode: ''
  }
}

// 依關鍵字過濾（ledger 已依日期新到舊排序）
const filtered = computed(() =>
  ledger.invoices.filter((i) =>
    `${i.number} ${i.seller}`.toLowerCase().includes(query.value.toLowerCase())
  )
)

// 統計：總張數、總金額、中獎張數與總獎金
const totalCount = computed(() => ledger.invoices.length)
const totalAmount = computed(() => ledger.invoices.reduce((s, i) => s + Number(i.amount || 0), 0))
const wonInvoices = computed(() => ledger.invoices.filter((i) => i.prizeStatus === 'won'))
const prizeTotal = computed(() => wonInvoices.value.reduce((s, i) => s + Number(i.prizeAmount || 0), 0))

// 對獎狀態徽章（不可手動修改）
function prizeBadge(inv) {
  if (inv.prizeStatus === 'won') {
    return { cls: 'won', text: `中獎 · ${inv.prizeName || '中獎'} ${money(inv.prizeAmount || 0)}` }
  }
  if (inv.prizeStatus === 'not_won') {
    return { cls: 'not-won', text: '未中獎' }
  }
  const date = drawDate(inv.period || periodOf(inv.date))
  if (date > todayInTaipei()) {
    const [, m, d] = date.split('-').map(Number)
    return { cls: 'pending', text: `待開獎 ${m}/${d}` }
  }
  return { cls: 'due', text: '待對獎' }
}

function openNew() {
  editingId.value = null
  form.value = blank()
  formError.value = ''
  showForm.value = true
}

function edit(inv) {
  editingId.value = inv.id
  form.value = {
    number: inv.number,
    date: inv.date,
    amount: inv.amount,
    seller: inv.seller || '',
    randomCode: inv.randomCode || ''
  }
  formError.value = ''
  showForm.value = true
}

function submit() {
  const number = normalizeInvoiceNumber(form.value.number)
  if (!isValidInvoiceNumber(number)) {
    formError.value = '發票號碼格式不正確（例如 AB-12345678）'
    return
  }
  if (!form.value.date) {
    formError.value = '請選擇開立日期'
    return
  }
  const amount = Math.round(Number(form.value.amount))
  if (!Number.isFinite(amount) || amount < 0) {
    formError.value = '金額必須是 0 以上的整數'
    return
  }
  const randomCode = (form.value.randomCode || '').trim()
  if (randomCode && !/^\d{4}$/.test(randomCode)) {
    formError.value = '隨機碼必須是 4 位數字'
    return
  }
  // 本機已經有相同號碼的其他發票就擋下
  if (ledger.invoices.some((i) => i.number === number && i.id !== editingId.value)) {
    formError.value = '這張發票已經登錄過'
    return
  }
  ledger.saveInvoice({
    id: editingId.value ?? undefined,
    number,
    date: form.value.date,
    amount,
    seller: (form.value.seller || '').trim(),
    randomCode
  })
  showForm.value = false
}

function remove(id) {
  if (confirm('確定刪除此張發票？連動的收支會取消與發票的關聯。')) ledger.deleteInvoice(id)
}
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow purple">E-INVOICE CENTER</div>
      <h1>電子發票管理</h1>
      <p>集中整理發票資訊，讓每筆消費都有跡可循。</p>
    </div>
    <button class="btn-primary" @click="openNew"><Plus :size="17" /> 新增發票</button>
  </div>

  <div class="invoice-summary-grid">
    <div class="invoice-summary">
      <span class="summary-icon lavender"><ReceiptText /></span>
      <div>
        <small>發票總張數</small>
        <b>{{ totalCount }} <em>張</em></b>
      </div>
    </div>
    <div class="invoice-summary">
      <span class="summary-icon mint"><span>$</span></span>
      <div>
        <small>發票總金額</small>
        <b>{{ money(totalAmount) }}</b>
      </div>
    </div>
    <div class="invoice-summary">
      <span class="summary-icon peach"><Trophy :size="21" /></span>
      <div>
        <small>中獎張數</small>
        <b>{{ wonInvoices.length }} <em>張</em></b>
        <small class="prize-sum">總獎金 {{ money(prizeTotal) }}</small>
      </div>
    </div>
  </div>

  <section class="panel records-panel">
    <div class="records-toolbar">
      <div>
        <h3>發票清單</h3>
        <p class="subheading">對獎狀態由系統自動更新</p>
      </div>
      <div class="search-box">
        <Search :size="17" />
        <input v-model="query" placeholder="搜尋發票號碼或店家..." />
      </div>
    </div>
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>發票號碼</th>
            <th>開立日期</th>
            <th>店家 / 開立人</th>
            <th>隨機碼</th>
            <th>對獎狀態</th>
            <th class="align-right">金額</th>
            <th class="align-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in filtered" :key="i.id">
            <td><span class="invoice-number">{{ formatInvoiceNumber(i.number) }}</span></td>
            <td>{{ i.date }}</td>
            <td>{{ i.seller || '—' }}</td>
            <td>{{ i.randomCode || '—' }}</td>
            <td>
              <span class="prize-badge" :class="prizeBadge(i).cls">{{ prizeBadge(i).text }}</span>
            </td>
            <td class="align-right amount-cell">{{ money(i.amount) }}</td>
            <td class="align-right">
              <button class="table-action" title="編輯" @click="edit(i)"><Pencil :size="15" /></button>
              <button class="table-action danger" title="刪除" @click="remove(i.id)"><Trash2 :size="15" /></button>
            </td>
          </tr>
          <tr v-if="!filtered.length">
            <td colspan="7" class="empty-state">尚無符合條件的發票。</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="table-foot">共 {{ totalCount }} 張發票
      <RouterLink to="/scanner">前往 QR 掃描輔助 <ArrowRight :size="13" /></RouterLink>
    </div>
  </section>

  <div v-if="showForm" class="modal-backdrop" @click.self="showForm = false">
    <section class="modal-card">
      <div class="modal-heading">
        <div>
          <h2>{{ editingId ? '編輯發票' : '新增發票' }}</h2>
          <p>可手動補登紙本收據或發票</p>
        </div>
        <button class="icon-button" @click="showForm = false"><X /></button>
      </div>
      <form class="form-grid" @submit.prevent="submit">
        <div class="form-field full">
          <label>發票號碼 *</label>
          <input v-model="form.number" required placeholder="例如：AB-12345678" />
        </div>
        <div class="form-field">
          <label>開立日期 *</label>
          <input v-model="form.date" type="date" required />
        </div>
        <div class="form-field">
          <label>金額（NT$）*</label>
          <input v-model="form.amount" type="number" min="0" step="1" required placeholder="0" />
        </div>
        <div class="form-field">
          <label>店家 / 開立人</label>
          <input v-model="form.seller" placeholder="選填" />
        </div>
        <div class="form-field">
          <label>隨機碼</label>
          <input v-model="form.randomCode" maxlength="4" inputmode="numeric" placeholder="4 位數（選填）" />
        </div>
        <p v-if="formError" class="error-text full">{{ formError }}</p>
        <div class="modal-actions full">
          <button type="button" class="btn-secondary" @click="showForm = false">取消</button>
          <button class="btn-primary" type="submit">儲存發票</button>
        </div>
      </form>
    </section>
  </div>
</template>
