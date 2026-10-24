<script setup>
// 掃描確認／補登表單：有統一發票或沒有發票（紙本收據）兩種模式。
// 掃描結果由父層寫進 modelValue；存檔成功後 emit('saved')，由父層顯示訊息並清空。
import { ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import {
  ArrowRight,
  Building2,
  ChevronDown,
  FileText,
  ListChecks,
  ReceiptText
} from 'lucide-vue-next'
import { useLedgerStore } from '../stores/ledger'
import { EXPENSE_CATEGORIES } from '../constants'
import { formatInvoiceNumber, isValidInvoiceNumber, money, normalizeInvoiceNumber } from '../utils/format'
import { uuid } from '../utils/uuid'

const props = defineProps({
  modelValue: { type: Object, required: true },
  mode: { type: String, default: 'manual' } // camera / photo / manual，只影響按鈕文字
})
const emit = defineEmits(['update:modelValue', 'saved'])

const ledger = useLedgerStore()
const errors = ref({})
const duplicate = ref(false)
const amountInput = ref(null)
const numberInput = ref(null)

const LAST_CATEGORY_KEY = 'receiptwise-last-category'

function setField(key, value) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

function setKind(kind) {
  errors.value = {}
  duplicate.value = false
  setField('kind', kind)
}

// 發票號碼輸入自動轉大寫
function onNumberInput(e) {
  setField('number', e.target.value.toUpperCase())
}

// 項目名稱預設跟著店家／號碼走，使用者改過就不再覆寫
const titleTouched = ref(false)
function onTitleInput(e) {
  titleTouched.value = true
  setField('title', e.target.value)
}
watch(
  () => [props.modelValue.seller, props.modelValue.number],
  () => {
    if (titleTouched.value) return
    const m = props.modelValue
    const number = normalizeInvoiceNumber(m.number)
    const fallback =
      (m.seller || '').trim() ||
      (isValidInvoiceNumber(number) ? `發票 ${formatInvoiceNumber(number)}` : '')
    if (m.title !== fallback) setField('title', fallback)
  },
  { immediate: true }
)

// 表單被父層清空（存檔成功）時，讓項目名稱恢復自動預設
watch(
  () => props.modelValue,
  (m) => {
    if (!m.number && !m.seller && !m.title) titleTouched.value = false
  }
)

function validateInvoice(m) {
  const errs = {}
  if (!isValidInvoiceNumber(m.number)) errs.number = '發票號碼格式不正確，例如 AB-12345678'
  if (!m.date) errs.date = '請選擇開立日期'
  const amount = Math.round(Number(m.amount))
  if (m.amount === '' || m.amount === null || !Number.isFinite(Number(m.amount)) || amount < 0) {
    errs.amount = '金額必須是 0 以上的整數'
  }
  const randomCode = (m.randomCode || '').trim()
  if (randomCode && !/^\d{4}$/.test(randomCode)) errs.randomCode = '隨機碼必須是 4 位數字'
  return errs
}

function validateReceipt(m) {
  const errs = {}
  if (!(m.title || '').trim()) errs.title = '請填寫項目名稱'
  if (!m.date) errs.date = '請選擇日期'
  const amount = Math.round(Number(m.amount))
  if (m.amount === '' || m.amount === null || !Number.isFinite(Number(m.amount)) || amount <= 0) {
    errs.amount = '金額必須大於 0'
  }
  return errs
}

function rememberCategory(category) {
  try {
    localStorage.setItem(LAST_CATEGORY_KEY, category)
  } catch {
    // localStorage 不可用就略過
  }
}

function saveInvoiceRecord(m, number) {
  const amount = Math.round(Number(m.amount))
  const seller = (m.seller || '').trim()
  const invoiceId = uuid()
  ledger.saveInvoice({
    id: invoiceId,
    number,
    date: m.date,
    amount,
    seller,
    sellerId: (m.sellerId || '').trim(),
    randomCode: (m.randomCode || '').trim(),
    items: m.items || [],
    source: m.source || 'manual'
  })
  if (m.alsoExpense) {
    const title = (m.title || '').trim() || seller || `發票 ${formatInvoiceNumber(number)}`
    ledger.saveTransaction({
      type: 'expense',
      title,
      category: m.category,
      amount,
      date: m.date,
      note: (m.note || '').trim(),
      invoiceId
    })
    rememberCategory(m.category)
  }
  errors.value = {}
  emit('saved', { kind: 'invoice', number, date: m.date, amount })
}

function saveReceiptRecord(m) {
  const amount = Math.round(Number(m.amount))
  ledger.saveTransaction({
    type: 'expense',
    title: (m.title || '').trim(),
    category: m.category,
    amount,
    date: m.date,
    note: (m.note || '').trim(),
    invoiceId: null
  })
  rememberCategory(m.category)
  errors.value = {}
  emit('saved', { kind: 'receipt', title: m.title, date: m.date, amount })
}

function submit() {
  const m = props.modelValue
  duplicate.value = false
  if (m.kind === 'invoice') {
    const errs = validateInvoice(m)
    errors.value = errs
    if (Object.keys(errs).length > 0) return
    const number = normalizeInvoiceNumber(m.number)
    // 已登錄過的號碼直接擋下（normalize 後比對）
    if (ledger.invoices.some((i) => normalizeInvoiceNumber(i.number) === number)) {
      duplicate.value = true
      return
    }
    saveInvoiceRecord(m, number)
    return
  }
  const errs = validateReceipt(m)
  errors.value = errs
  if (Object.keys(errs).length > 0) return
  saveReceiptRecord(m)
}

// 由父層呼叫：聚焦欄位（一維條碼 → 金額；OCR 缺號碼 → 號碼）
function focusAmount() {
  amountInput.value?.focus()
}

function focusNumber() {
  numberInput.value?.focus()
}

defineExpose({ focusAmount, focusNumber })
</script>

<template>
  <form class="form-stack capture-form" novalidate @submit.prevent="submit">
    <div class="kind-toggle">
      <button type="button" :class="{ active: modelValue.kind !== 'receipt' }" @click="setKind('invoice')">
        <ReceiptText :size="15" /> 有統一發票
      </button>
      <button type="button" :class="{ active: modelValue.kind === 'receipt' }" @click="setKind('receipt')">
        <FileText :size="15" /> 沒有發票（紙本收據）
      </button>
    </div>

    <!-- 有統一發票 -->
    <template v-if="modelValue.kind !== 'receipt'">
      <div class="form-field" :class="{ invalid: errors.number }">
        <label for="cap-number">發票號碼 *</label>
        <input
          id="cap-number"
          ref="numberInput"
          :value="modelValue.number"
          placeholder="例如：AB-12345678"
          autocomplete="off"
          @input="onNumberInput"
        />
        <p v-if="errors.number" class="field-error">{{ errors.number }}</p>
      </div>

      <div class="form-grid-2">
        <div class="form-field" :class="{ invalid: errors.date }">
          <label for="cap-date">開立日期 *</label>
          <input
            id="cap-date"
            type="date"
            :value="modelValue.date"
            @change="setField('date', $event.target.value)"
          />
          <p v-if="errors.date" class="field-error">{{ errors.date }}</p>
        </div>
        <div class="form-field" :class="{ invalid: errors.amount }">
          <label for="cap-amount">金額（NT$）*</label>
          <input
            id="cap-amount"
            ref="amountInput"
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            placeholder="0"
            :value="modelValue.amount"
            @input="setField('amount', $event.target.value)"
          />
          <p v-if="errors.amount" class="field-error">{{ errors.amount }}</p>
        </div>
      </div>

      <div class="form-grid-2">
        <div class="form-field">
          <label for="cap-seller">店家名稱</label>
          <input id="cap-seller" :value="modelValue.seller" placeholder="選填" @input="setField('seller', $event.target.value)" />
        </div>
        <div class="form-field">
          <label for="cap-random">隨機碼</label>
          <input
            id="cap-random"
            :value="modelValue.randomCode"
            maxlength="4"
            inputmode="numeric"
            placeholder="4 位數（選填）"
            @input="setField('randomCode', $event.target.value)"
          />
        </div>
      </div>

      <p v-if="modelValue.sellerId" class="seller-id-note"><Building2 :size="13" /> 賣方統編 {{ modelValue.sellerId }}</p>

      <details v-if="modelValue.items && modelValue.items.length" class="item-fold">
        <summary>
          <ListChecks :size="14" /> 品目（{{ modelValue.items.length }} 項）
          <ChevronDown :size="14" class="chev" />
        </summary>
        <ul class="item-list">
          <li v-for="(item, idx) in modelValue.items" :key="idx">
            <span class="item-name">{{ item.name || '（未命名）' }}</span>
            <span class="item-qty">{{ item.qty }} ×</span>
            <span class="item-price">{{ money(item.price) }}</span>
          </li>
        </ul>
      </details>
    </template>

    <!-- 沒有發票（紙本收據） -->
    <template v-else>
      <div class="form-field" :class="{ invalid: errors.title }">
        <label for="cap-title">項目名稱 *</label>
        <input
          id="cap-title"
          :value="modelValue.title"
          placeholder="例如：早餐店三明治"
          @input="onTitleInput"
        />
        <p v-if="errors.title" class="field-error">{{ errors.title }}</p>
      </div>

      <div class="form-grid-2">
        <div class="form-field" :class="{ invalid: errors.amount }">
          <label for="cap-amount-receipt">金額（NT$）*</label>
          <input
            id="cap-amount-receipt"
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
            placeholder="0"
            :value="modelValue.amount"
            @input="setField('amount', $event.target.value)"
          />
          <p v-if="errors.amount" class="field-error">{{ errors.amount }}</p>
        </div>
        <div class="form-field" :class="{ invalid: errors.date }">
          <label for="cap-date-receipt">日期 *</label>
          <input
            id="cap-date-receipt"
            type="date"
            :value="modelValue.date"
            @change="setField('date', $event.target.value)"
          />
          <p v-if="errors.date" class="field-error">{{ errors.date }}</p>
        </div>
      </div>
    </template>

    <!-- 同時記一筆支出（發票模式）／分類與備註 -->
    <template v-if="modelValue.kind !== 'receipt'">
      <label class="check-row">
        <input
          type="checkbox"
          :checked="modelValue.alsoExpense"
          @change="setField('alsoExpense', $event.target.checked)"
        />
        <span>同時記一筆支出</span>
      </label>

      <div v-if="modelValue.alsoExpense" class="expense-box">
        <div class="form-field">
          <label for="cap-expense-title">項目名稱</label>
          <input id="cap-expense-title" :value="modelValue.title" placeholder="預設用店家名稱或發票號碼" @input="onTitleInput" />
        </div>
        <div class="form-field">
          <label for="cap-category">分類</label>
          <select id="cap-category" :value="modelValue.category" @change="setField('category', $event.target.value)">
            <option v-for="c in EXPENSE_CATEGORIES" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <div class="form-field">
          <label for="cap-note">備註</label>
          <input id="cap-note" :value="modelValue.note" placeholder="選填" @input="setField('note', $event.target.value)" />
        </div>
      </div>
    </template>

    <div v-else class="expense-box">
      <div class="form-field">
        <label for="cap-category-receipt">分類</label>
        <select
          id="cap-category-receipt"
          :value="modelValue.category"
          @change="setField('category', $event.target.value)"
        >
          <option v-for="c in EXPENSE_CATEGORIES" :key="c" :value="c">{{ c }}</option>
        </select>
      </div>
      <div class="form-field">
        <label for="cap-note-receipt">備註</label>
        <input id="cap-note-receipt" :value="modelValue.note" placeholder="選填" @input="setField('note', $event.target.value)" />
      </div>
    </div>

    <p v-if="duplicate" class="inline-notice warn dup-notice">
      這張發票已經登錄過了。<RouterLink to="/invoices">查看發票清單</RouterLink>
    </p>

    <button class="btn-primary full-button" type="submit">
      {{
        modelValue.kind === 'receipt'
          ? '儲存支出'
          : modelValue.alsoExpense
            ? '儲存發票與支出'
            : '儲存發票'
      }}
      <ArrowRight :size="15" />
    </button>
  </form>
</template>
