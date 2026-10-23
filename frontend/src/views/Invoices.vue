<script setup>
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { Plus, Search, Pencil, Trash2, X, ReceiptText, ArrowRight } from 'lucide-vue-next'
import { getInvoices, saveInvoices, money } from '../api'

const rows = ref(getInvoices())
const query = ref('')
const showForm = ref(false)
const editingId = ref(null)
const form = ref(blank())

// 表單的空白欄位樣板
function blank() {
  return {
    number: '',
    date: new Date().toISOString().slice(0, 10),
    amount: '',
    seller: '',
    randomCode: '',
    status: '待核對'
  }
}

// 依關鍵字過濾發票，再按日期由新到舊排序
const filtered = computed(() =>
  rows.value
    .filter(i => `${i.number} ${i.seller}`.toLowerCase().includes(query.value.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date))
)

// 發票總金額
const total = computed(() => rows.value.reduce((s, i) => s + Number(i.amount), 0))

function openNew() {
  editingId.value = null
  form.value = blank()
  showForm.value = true
}

function edit(i) {
  editingId.value = i.id
  form.value = { ...i }
  showForm.value = true
}

// 新增或更新一筆發票
function submit() {
  if (!form.value.number.trim() || !form.value.date || Number(form.value.amount) < 0)
    return alert('請填寫發票號碼、日期與有效金額')
  const item = {
    ...form.value,
    id: editingId.value ?? Date.now(),
    amount: Number(form.value.amount),
    number: form.value.number.trim().toUpperCase()
  }
  if (editingId.value) rows.value = rows.value.map(i => i.id === editingId.value ? item : i)
  else rows.value.unshift(item)
  saveInvoices(rows.value)
  showForm.value = false
}

// 確認後刪除一筆發票
function remove(id) {
  if (confirm('確定刪除此張發票？')) {
    rows.value = rows.value.filter(i => i.id !== id)
    saveInvoices(rows.value)
  }
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
        <b>{{ rows.length }} <em>張</em></b>
      </div>
    </div>
    <div class="invoice-summary">
      <span class="summary-icon mint"><span>$</span></span>
      <div>
        <small>發票總金額</small>
        <b>{{ money(total) }}</b>
      </div>
    </div>
    <div class="invoice-summary">
      <span class="summary-icon peach">◷</span>
      <div>
        <small>待核對發票</small>
        <b>{{ rows.filter(i => i.status === '待核對').length }} <em>張</em></b>
      </div>
    </div>
  </div>

  <section class="panel records-panel">
    <div class="records-toolbar">
      <div>
        <h3>發票清單</h3>
        <p class="subheading">可新增、編輯與刪除本機發票資料</p>
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
            <th>核對狀態</th>
            <th class="align-right">金額</th>
            <th class="align-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in filtered" :key="i.id">
            <td><span class="invoice-number">{{ i.number }}</span></td>
            <td>{{ i.date }}</td>
            <td>{{ i.seller || '—' }}</td>
            <td>{{ i.randomCode || '—' }}</td>
            <td>
              <select class="status-select" v-model="i.status" @change="saveInvoices(rows)">
                <option>待核對</option>
                <option>已核對</option>
                <option>中獎</option>
                <option>未中獎</option>
              </select>
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
    <div class="table-foot">共 {{ rows.length }} 張發票
      <RouterLink to="/scanner">前往 QR 掃描輔助 <ArrowRight :size="13" /></RouterLink>
    </div>
  </section>

  <div class="notice-strip bottom-notice">
    <span class="notice-icon">ⓘ</span>
    <span>此頁面為前端示範；發票資料暫存在瀏覽器，不會自動從財政部或電子發票平台匯入。</span>
  </div>

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
          <input v-model="form.amount" type="number" min="0" required placeholder="0" />
        </div>
        <div class="form-field">
          <label>店家 / 開立人</label>
          <input v-model="form.seller" placeholder="選填" />
        </div>
        <div class="form-field">
          <label>隨機碼</label>
          <input v-model="form.randomCode" maxlength="4" placeholder="4 位數（選填）" />
        </div>
        <div class="form-field">
          <label>核對狀態</label>
          <select v-model="form.status">
            <option>待核對</option>
            <option>已核對</option>
            <option>中獎</option>
            <option>未中獎</option>
          </select>
        </div>
        <div class="modal-actions full">
          <button type="button" class="btn-secondary" @click="showForm = false">取消</button>
          <button class="btn-primary" type="submit">儲存發票</button>
        </div>
      </form>
    </section>
  </div>
</template>
