<script setup>
// 掃描／補登頁：相機掃描、拍照・上傳圖片解析、手動補登；
// 解碼結果統一進 handleDecoded 流程，填入右欄確認表單。
import { computed, nextTick, ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  ArrowRight,
  Barcode,
  Camera,
  CircleCheckBig,
  ImageUp,
  Keyboard,
  PencilLine,
  QrCode,
  RotateCcw,
  ScanLine
} from 'lucide-vue-next'
import QrScanner from '../components/QrScanner.vue'
import InvoiceCaptureForm from '../components/InvoiceCaptureForm.vue'
import { useLedgerStore } from '../stores/ledger'
import { mergeItems, parseEInvoiceCode } from '../utils/einvoice'
import { classifyScanTexts, scanImageFile } from '../utils/imageScan'
import { drawDate, periodOf, periodRange, todayInTaipei } from '../utils/period'
import { EXPENSE_CATEGORIES } from '../constants'
import { formatInvoiceNumber, isValidInvoiceNumber, money, normalizeInvoiceNumber } from '../utils/format'

const ledger = useLedgerStore()

const mode = ref('camera') // camera / photo / manual
const tabs = [
  { key: 'camera', label: '相機掃描', icon: Camera },
  { key: 'photo', label: '拍照・上傳圖片', icon: ImageUp },
  { key: 'manual', label: '手動補登', icon: Keyboard }
]

// 掃描回饋訊息 { kind: success/info/warn/error, text }；transient 模式一下下就自動消失
const notice = ref(null)
let noticeTimer = null
function setNotice(kind, text, { transient = false } = {}) {
  notice.value = { kind, text }
  clearTimeout(noticeTimer)
  if (transient) noticeTimer = setTimeout(() => (notice.value = null), 2500)
}

// 記住上次用的支出分類（寫在 InvoiceCaptureForm，這裡讀來當預設）
function defaultCategory() {
  try {
    const saved = localStorage.getItem('receiptwise-last-category')
    if (saved && EXPENSE_CATEGORIES.includes(saved)) return saved
  } catch {
    // localStorage 不可用就用預設
  }
  return '餐飲'
}

function blankForm() {
  return {
    kind: 'invoice', // invoice=有統一發票 receipt=沒有發票（紙本收據）
    number: '',
    date: todayInTaipei(),
    amount: '',
    seller: '',
    randomCode: '',
    sellerId: '',
    items: [],
    source: 'manual',
    alsoExpense: true,
    title: '',
    category: defaultCategory(),
    note: ''
  }
}

const form = ref(blankForm())
const pendingRightItems = ref([]) // 先掃到右側 QR 時暫存的品目
const savedInfo = ref(null) // 存檔成功訊息 { text, sub }
const scanningImage = ref(false)

const qrScanner = ref(null) // QrScanner 實例（start/stop）
const captureForm = ref(null) // InvoiceCaptureForm 實例（focusAmount）
const formPanel = ref(null) // 右欄 panel（手機版捲動用）

function switchMode(key) {
  if (mode.value === key) return
  mode.value = key
  notice.value = null
  savedInfo.value = null
  qrScanner.value?.stop() // 離開相機模式時停相機（v-if 卸載時也會停）
}

function vibrate() {
  try {
    navigator.vibrate?.(80)
  } catch {
    // 不支援就略過
  }
}

// 手機版：掃描成功後自動捲到確認表單
async function scrollFormIntoView() {
  if (typeof window !== 'undefined' && window.innerWidth > 600) return
  await nextTick()
  formPanel.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// 左側 QR：號碼、日期、金額、隨機碼、統編、品目一次補齊
function applyLeftQr(parsed) {
  const merged =
    pendingRightItems.value.length > 0 ? mergeItems(parsed, { items: pendingRightItems.value }) : parsed
  pendingRightItems.value = []
  form.value = {
    ...form.value,
    kind: 'invoice',
    number: merged.number,
    date: merged.date,
    amount: merged.totalAmount != null ? String(merged.totalAmount) : '',
    seller: '',
    randomCode: merged.randomCode || '',
    sellerId: merged.sellerId || '',
    items: merged.items || [],
    source: 'qr'
  }
  vibrate()
  setNotice('success', `已讀取發票 ${formatInvoiceNumber(merged.number)}`)
  scrollFormIntoView()
}

// 右側 QR：只有品目。已有左側資料就合併，否則暫存並提示改掃左側
function applyRightQr(parsed, fromCamera) {
  const items = parsed.items || []
  if (isValidInvoiceNumber(normalizeInvoiceNumber(form.value.number))) {
    form.value = { ...form.value, items: [...(form.value.items || []), ...items] }
    setNotice('info', `已合併右側 QR Code 的 ${items.length} 項品目`)
    return
  }
  pendingRightItems.value = [...pendingRightItems.value, ...items]
  // 相機繼續掃，不停下來
  setNotice('info', '這是右側 QR Code，請對準左側的 QR Code', { transient: fromCamera })
}

// 一維條碼：只有號碼與隨機碼；日期猜該期內最合理的一天，金額留空待補
function applyBarcode(parsed) {
  const range = periodRange(parsed.period)
  const today = todayInTaipei()
  form.value = {
    ...form.value,
    kind: 'invoice',
    number: parsed.number,
    amount: '',
    seller: '',
    randomCode: parsed.randomCode || '',
    sellerId: '',
    items: [],
    source: 'barcode',
    date: today >= range.start && today <= range.end ? today : range.end
  }
  vibrate()
  setNotice('warn', '一維條碼沒有金額，請補上消費金額')
  scrollFormIntoView()
  nextTick(() => captureForm.value?.focusAmount())
}

// 相機解碼回來的單一文字
function onDecoded(text) {
  const parsed = parseEInvoiceCode(text)
  switch (parsed.kind) {
    case 'left-qr':
      qrScanner.value?.stop()
      applyLeftQr(parsed)
      break
    case 'right-qr':
      applyRightQr(parsed, true)
      break
    case 'barcode':
      qrScanner.value?.stop()
      applyBarcode(parsed)
      break
    default:
      // 相機一直解到無法辨識的條碼時只短暫提示，不洗版
      setNotice('warn', '無法辨識的條碼，請對準發票上的條碼', { transient: true })
  }
}

// 拍照・上傳：解出圖片中所有條碼，左 QR 優先，其次條碼、右 QR
async function onImageChange(e) {
  const file = e.target.files?.[0]
  e.target.value = '' // 允許重選同一張
  if (!file) return
  scanningImage.value = true
  notice.value = null
  savedInfo.value = null
  try {
    const texts = await scanImageFile(file)
    const found = classifyScanTexts(texts)
    if (found.leftQr) {
      // 同一張圖同時解出右側 QR 時直接合併
      if (found.rightQr?.items?.length) pendingRightItems.value = found.rightQr.items
      applyLeftQr(found.leftQr)
      return
    }
    if (found.barcode) {
      applyBarcode(found.barcode)
      return
    }
    if (found.rightQr) {
      applyRightQr(found.rightQr, false)
      return
    }
    setNotice('error', '圖片中找不到發票條碼，請拍清楚一點，或改用手動補登。')
  } catch {
    setNotice('error', '圖片解析失敗，請重試或改用手動補登。')
  } finally {
    scanningImage.value = false
  }
}

// 表單存檔完成：顯示成功訊息並清空表單
function onSaved(payload) {
  pendingRightItems.value = []
  notice.value = null
  if (payload.kind === 'invoice') {
    const draw = drawDate(periodOf(payload.date))
    const sub = draw > todayInTaipei() ? `將於 ${draw.slice(5).replace('-', '/')} 開獎，開獎後會自動對獎` : ''
    savedInfo.value = { text: `已儲存發票 ${formatInvoiceNumber(normalizeInvoiceNumber(payload.number))}`, sub }
  } else {
    savedInfo.value = { text: `已儲存支出 ${money(payload.amount)}`, sub: '' }
  }
  form.value = blankForm()
  scrollFormIntoView()
}

// 存檔成功後重新開相機繼續掃
function resumeScanning() {
  savedInfo.value = null
  qrScanner.value?.start()
}

// 最近登錄（ledger.invoices 已依日期新到舊排序）
const recentInvoices = computed(() => ledger.invoices.slice(0, 5))

const SOURCE_META = {
  qr: { icon: QrCode, label: 'QR Code 掃描' },
  barcode: { icon: Barcode, label: '一維條碼' },
  manual: { icon: PencilLine, label: '手動輸入' }
}
function sourceMeta(source) {
  return SOURCE_META[source] || SOURCE_META.manual
}
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow purple">QUICK CAPTURE</div>
      <h1>掃描發票</h1>
      <p>掃描電子發票的 QR Code 或一維條碼，確認後同時記錄發票與支出；也可以手動補登。</p>
    </div>
  </div>

  <div class="mode-tabs" role="tablist">
    <button
      v-for="t in tabs"
      :key="t.key"
      type="button"
      class="mode-tab"
      :class="{ active: mode === t.key }"
      @click="switchMode(t.key)"
    >
      <component :is="t.icon" :size="15" />
      <span>{{ t.label }}</span>
    </button>
  </div>

  <div class="scanner-layout">
    <!-- 左欄：掃描區 -->
    <section class="panel scanner-main">
      <template v-if="mode === 'camera'">
        <h2 class="scanner-section-title"><ScanLine :size="18" /> 相機掃描</h2>
        <p class="scanner-intro">按「開啟相機」後對準發票條碼；需要 HTTPS 或 localhost 環境。</p>
        <QrScanner ref="qrScanner" @decoded="onDecoded" @switch-photo="switchMode('photo')" />
        <p v-if="notice" class="inline-notice" :class="notice.kind">{{ notice.text }}</p>
      </template>

      <template v-else-if="mode === 'photo'">
        <h2 class="scanner-section-title"><ImageUp :size="18" /> 拍照・上傳圖片</h2>
        <p class="scanner-intro">拍下整張發票（條碼清楚、避免反光），會自動解析圖片中的 QR Code 與一維條碼；沒有 HTTPS 也能用。</p>
        <label class="photo-drop" :class="{ busy: scanningImage }">
          <input type="file" accept="image/*" capture="environment" hidden @change="onImageChange" />
          <span class="scan-frame">
            <span class="corner tl"></span>
            <span class="corner tr"></span>
            <span class="corner bl"></span>
            <span class="corner br"></span>
            <ImageUp :size="38" stroke-width="1.3" />
          </span>
          <b>{{ scanningImage ? '解析中…' : '拍照或選擇圖片' }}</b>
          <span class="photo-hint">手機上會直接開啟相機</span>
        </label>
        <p v-if="notice" class="inline-notice" :class="notice.kind">{{ notice.text }}</p>
      </template>

      <template v-else>
        <h2 class="scanner-section-title"><Keyboard :size="18" /> 手動補登</h2>
        <p class="scanner-intro">在右邊表單直接輸入發票資訊；沒有發票的紙本收據請切換成「沒有發票（紙本收據）」，只記一筆支出。</p>
        <p v-if="notice" class="inline-notice" :class="notice.kind">{{ notice.text }}</p>
      </template>

      <!-- 最近登錄 -->
      <div class="recent-block">
        <div class="recent-head">
          <h3>最近登錄</h3>
          <RouterLink to="/invoices" class="recent-more">查看全部 <ArrowRight :size="13" /></RouterLink>
        </div>
        <ul v-if="recentInvoices.length" class="recent-list">
          <li v-for="inv in recentInvoices" :key="inv.id">
            <component :is="sourceMeta(inv.source).icon" :size="15" class="source-icon" :title="sourceMeta(inv.source).label" />
            <span class="recent-number">{{ formatInvoiceNumber(inv.number) }}</span>
            <span class="recent-seller">{{ inv.seller || '—' }}</span>
            <b class="recent-amount">{{ money(inv.amount) }}</b>
          </li>
        </ul>
        <p v-else class="recent-empty">還沒有登錄的發票，掃描後會出現在這裡。</p>
      </div>
    </section>

    <!-- 右欄：確認／補登表單 -->
    <section ref="formPanel" class="panel scanner-form-panel">
      <div v-if="savedInfo" class="save-success">
        <CircleCheckBig :size="19" />
        <div class="save-success-text">
          <b>{{ savedInfo.text }}</b>
          <p v-if="savedInfo.sub">{{ savedInfo.sub }}</p>
        </div>
        <button v-if="mode === 'camera'" type="button" class="btn-secondary" @click="resumeScanning">
          <RotateCcw :size="14" /> 繼續掃描
        </button>
      </div>
      <InvoiceCaptureForm v-model="form" :mode="mode" ref="captureForm" @saved="onSaved" />
    </section>
  </div>
</template>
