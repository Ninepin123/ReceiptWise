<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Plus, Search, Pencil, Trash2, X, ReceiptText } from 'lucide-vue-next'
import { useLedgerStore } from '../stores/ledger'
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../constants'
import { money } from '../utils/format'
import { monthKey } from '../utils/stats'
import { todayInTaipei } from '../utils/period'

const route = useRoute()
const router = useRouter()
const ledger = useLedgerStore()

const query = ref('')
const filter = ref('all')
const monthFilter = ref('all')
const showForm = ref(false)
const editingId = ref(null)
const formError = ref('')
const form = ref(blank())

function blank() {
  return {
    type: 'expense',
    title: '',
    category: '餐飲',
    amount: '',
    date: todayInTaipei(),
    note: ''
  }
}

// 分類選單依類型切換
const categoryOptions = computed(() =>
  form.value.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
)

function setType(type) {
  form.value.type = type
  if (!categoryOptions.value.includes(form.value.category)) {
    form.value.category = categoryOptions.value[0]
  }
}

// 資料中出現過的月份（新到舊）
const monthOptions = computed(() =>
  [...new Set(ledger.transactions.map((t) => monthKey(t.date)))].sort((a, b) => b.localeCompare(a))
)

// 依類型、月份與關鍵字篩選（ledger 已依日期新到舊排序）
const filtered = computed(() =>
  ledger.transactions.filter(
    (t) =>
      (filter.value === 'all' || t.type === filter.value) &&
      (monthFilter.value === 'all' || monthKey(t.date) === monthFilter.value) &&
      `${t.title} ${t.category} ${t.note || ''}`.toLowerCase().includes(query.value.toLowerCase())
  )
)

// 統計卡依目前篩選結果計算
const totalIncome = computed(() =>
  filtered.value.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0)
)
const totalExpense = computed(() =>
  filtered.value.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)
)

function openNew() {
  editingId.value = null
  form.value = blank()
  formError.value = ''
  showForm.value = true
}

function edit(t) {
  editingId.value = t.id
  form.value = { ...blank(), ...t }
  formError.value = ''
  showForm.value = true
}

function submit() {
  const amount = Math.round(Number(form.value.amount))
  if (!form.value.title.trim()) {
    formError.value = '請填寫項目名稱'
    return
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    formError.value = '金額必須是大於 0 的整數'
    return
  }
  if (!form.value.date) {
    formError.value = '請選擇日期'
    return
  }
  ledger.saveTransaction({
    ...form.value,
    id: editingId.value ?? undefined,
    title: form.value.title.trim(),
    amount
  })
  showForm.value = false
}

function remove(id) {
  if (confirm('確定要刪除此筆紀錄嗎？')) ledger.deleteTransaction(id)
}

// 網址帶 ?new=1 時自動打開新增視窗，並把 query 清掉
onMounted(() => {
  if (route.query.new) {
    openNew()
    router.replace({ query: { ...route.query, new: undefined } })
  }
})
</script>

<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow purple">TRANSACTION MANAGEMENT</div>
      <h1>收支管理</h1>
      <p>完整記錄每一筆收入與支出，讓財務更有方向。</p>
    </div>
    <button class="btn-primary" @click="openNew"><Plus :size="17" /> 新增紀錄</button>
  </div>

  <div class="stats-grid compact-stats">
    <div class="stat-card">
      <div class="stat-top">
        <span class="stat-label">收入總計</span>
        <span class="stat-icon mint">↗</span>
      </div>
      <div class="stat-value positive">{{ money(totalIncome) }}</div>
      <div class="stat-hint">目前篩選條件下的收入</div>
    </div>
    <div class="stat-card">
      <div class="stat-top">
        <span class="stat-label">支出總計</span>
        <span class="stat-icon peach">↘</span>
      </div>
      <div class="stat-value negative">{{ money(totalExpense) }}</div>
      <div class="stat-hint">目前篩選條件下的支出</div>
    </div>
    <div class="stat-card">
      <div class="stat-top">
        <span class="stat-label">紀錄筆數</span>
        <span class="stat-icon purple">▤</span>
      </div>
      <div class="stat-value">{{ filtered.length }} <small>筆</small></div>
      <div class="stat-hint">雲端同步的紀錄</div>
    </div>
  </div>

  <section class="panel records-panel">
    <div class="records-toolbar">
      <div class="filter-tabs">
        <button
          v-for="item in [{v:'all',l:'全部紀錄'},{v:'income',l:'收入'},{v:'expense',l:'支出'}]"
          :key="item.v"
          :class="{ selected: filter === item.v }"
          @click="filter = item.v"
        >{{ item.l }}</button>
      </div>
      <div class="search-box">
        <Search :size="17" />
        <input v-model="query" placeholder="搜尋項目或分類..." />
      </div>
      <select v-model="monthFilter" class="month-filter">
        <option value="all">全部月份</option>
        <option v-for="m in monthOptions" :key="m" :value="m">{{ m }}</option>
      </select>
    </div>
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>項目</th>
            <th>分類</th>
            <th>日期</th>
            <th>備註</th>
            <th class="align-right">金額</th>
            <th class="align-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in filtered" :key="t.id">
            <td>
              <span class="transaction-title">
                <span
                  class="transaction-badge"
                  :class="t.type"
                >{{ t.type === 'income' ? '↗' : '↘' }}</span>{{ t.title }}
                <span v-if="t.invoiceId" class="invoice-link-icon" title="由發票建立">
                  <ReceiptText :size="13" />
                </span>
              </span>
            </td>
            <td>
              <span class="category-chip">{{ t.category }}</span>
            </td>
            <td>{{ t.date }}</td>
            <td class="muted-cell">{{ t.note || '—' }}</td>
            <td
              class="align-right amount-cell"
              :class="t.type"
            >{{ t.type === 'income' ? '+' : '−' }}{{ money(t.amount) }}</td>
            <td class="align-right">
              <button
                class="table-action"
                title="編輯"
                @click="edit(t)"
              ><Pencil :size="15" /></button>
              <button
                class="table-action danger"
                title="刪除"
                @click="remove(t.id)"
              ><Trash2 :size="15" /></button>
            </td>
          </tr>
          <tr v-if="!filtered.length">
            <td colspan="6" class="empty-state">找不到符合條件的紀錄。</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="table-foot">顯示 {{ filtered.length }} 筆紀錄 <span>資料已同步到雲端</span></div>
  </section>

  <div v-if="showForm" class="modal-backdrop" @click.self="showForm = false">
    <section class="modal-card">
      <div class="modal-heading">
        <div>
          <h2>{{ editingId ? '編輯紀錄' : '新增紀錄' }}</h2>
          <p>填寫這筆收支的基本資訊</p>
        </div>
        <button class="icon-button" @click="showForm = false"><X /></button>
      </div>
      <form class="form-grid" @submit.prevent="submit">
        <div class="form-field full">
          <label>交易類型</label>
          <div class="type-switch">
            <button
              type="button"
              :class="{ active: form.type === 'expense' }"
              @click="setType('expense')"
            >支出</button>
            <button
              type="button"
              :class="{ active: form.type === 'income' }"
              @click="setType('income')"
            >收入</button>
          </div>
        </div>
        <div class="form-field full">
          <label>項目名稱 *</label>
          <input v-model="form.title" required placeholder="例如：午餐、薪資" />
        </div>
        <div class="form-field">
          <label>金額（NT$）*</label>
          <input v-model="form.amount" required type="number" min="1" step="1" placeholder="0" />
        </div>
        <div class="form-field">
          <label>分類</label>
          <select v-model="form.category">
            <option v-for="c in categoryOptions" :key="c">{{ c }}</option>
          </select>
        </div>
        <div class="form-field">
          <label>日期 *</label>
          <input v-model="form.date" required type="date" />
        </div>
        <div class="form-field">
          <label>備註</label>
          <input v-model="form.note" placeholder="選填" />
        </div>
        <p v-if="formError" class="error-text full">{{ formError }}</p>
        <div class="modal-actions full">
          <button type="button" class="btn-secondary" @click="showForm = false">取消</button>
          <button type="submit" class="btn-primary">儲存紀錄</button>
        </div>
      </form>
    </section>
  </div>
</template>
