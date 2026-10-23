<script setup>
import { computed, ref } from 'vue'
import { Plus, Search, Pencil, Trash2, X, ArrowUpDown } from 'lucide-vue-next'
import { getTransactions, saveTransactions, money } from '../api'

const rows = ref(getTransactions())
const query = ref('')
const filter = ref('all')
const showForm = ref(false)
const editingId = ref(null)
const form = ref(blank())

function blank() {
  return {
    type: 'expense',
    title: '',
    category: '餐飲',
    amount: '',
    date: new Date().toISOString().slice(0, 10),
    note: ''
  }
}

const categories = ['餐飲', '交通', '娛樂', '購物', '居家', '醫療', '薪資', '其他收入', '其他']

// 依類型分頁與搜尋關鍵字篩選，日期由新到舊排序
const filtered = computed(() =>
  rows.value
    .filter(
      t =>
        (filter.value === 'all' || t.type === filter.value) &&
        `${t.title} ${t.category} ${t.note || ''}`.toLowerCase().includes(query.value.toLowerCase())
    )
    .sort((a, b) => b.date.localeCompare(a.date))
)

const totalIncome = computed(() =>
  rows.value.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0)
)
const totalExpense = computed(() =>
  rows.value.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)
)

function persist() {
  saveTransactions(rows.value)
}

function openNew() {
  editingId.value = null
  form.value = blank()
  showForm.value = true
}

function edit(t) {
  editingId.value = t.id
  form.value = { ...t }
  showForm.value = true
}

function submit() {
  if (!form.value.title.trim() || Number(form.value.amount) <= 0 || !form.value.date)
    return alert('請填寫項目、有效金額與日期')

  const item = {
    ...form.value,
    id: editingId.value ?? Date.now(),
    amount: Number(form.value.amount),
    title: form.value.title.trim()
  }

  if (editingId.value) rows.value = rows.value.map(t => (t.id === editingId.value ? item : t))
  else rows.value.unshift(item)

  persist()
  showForm.value = false
}

function remove(id) {
  if (confirm('確定要刪除此筆紀錄嗎？')) {
    rows.value = rows.value.filter(t => t.id !== id)
    persist()
  }
}
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
      <div class="stat-hint">所有已記錄收入</div>
    </div>
    <div class="stat-card">
      <div class="stat-top">
        <span class="stat-label">支出總計</span>
        <span class="stat-icon peach">↘</span>
      </div>
      <div class="stat-value negative">{{ money(totalExpense) }}</div>
      <div class="stat-hint">所有已記錄支出</div>
    </div>
    <div class="stat-card">
      <div class="stat-top">
        <span class="stat-label">紀錄筆數</span>
        <span class="stat-icon purple">▤</span>
      </div>
      <div class="stat-value">{{ rows.length }} <small>筆</small></div>
      <div class="stat-hint">本機瀏覽器資料</div>
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
                >{{ t.type === 'income' ? '↗' : '↘' }}</span>{{ t.title }}</span>
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
    <div class="table-foot">顯示 {{ filtered.length }} 筆紀錄 <span>資料暫存於此瀏覽器</span></div>
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
              @click="form.type = 'expense'"
            >支出</button>
            <button
              type="button"
              :class="{ active: form.type === 'income' }"
              @click="form.type = 'income'"
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
            <option v-for="c in categories" :key="c">{{ c }}</option>
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
        <div class="modal-actions full">
          <button type="button" class="btn-secondary" @click="showForm = false">取消</button>
          <button type="submit" class="btn-primary">儲存紀錄</button>
        </div>
      </form>
    </section>
  </div>
</template>
