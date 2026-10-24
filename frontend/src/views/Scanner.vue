<script setup>
// 掃描／補登頁：相機掃描、拍照・上傳圖片解析、手動補登；
// 解碼結果統一交給 scanSession 狀態機決定怎麼用，再填入右欄確認表單。
// QR 讀不到時（摺痕讓 QR 變形等）自動改用後端 OCR 讀文字。
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
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
  ScanLine,
  ScanText
} from 'lucide-vue-next'
import QrScanner from '../components/QrScanner.vue'
import InvoiceCaptureForm from '../components/InvoiceCaptureForm.vue'
import { useLedgerStore } from '../stores/ledger'
import { ApiError, NetworkError } from '../api/client'
import { mergeItems } from '../utils/einvoice'
import { classifyScanTexts, scanImageFile } from '../utils/imageScan'
import { buildOcrForm, recognizeInvoiceText } from '../utils/invoiceOcr'
import { createScanSession, handleScanTexts, scanTick } from '../utils/scanSession'
import { drawDate, periodOf, periodRange, todayInTaipei } from '../utils/period'
import { EXPENSE_CATEGORIES } from '../constants'
import { formatInvoiceNumber, money, normalizeInvoiceNumber } from '../utils/format'

const ledger = useLedgerStore()

const mode = ref('camera') // camera / photo / manual
const tabs = [
  { key: 'camera', label: '相機掃描', icon: Camera },
  { key: 'photo', label: '拍照・上傳圖片', icon: ImageUp },
  { key: 'manual', label: '手動補登', icon: Keyboard }
]

// 掃描回饋訊息 { kind: success/info/warn/error, text, action? }；transient 模式一下下就自動消失
const notice = ref(null)
let noticeTimer = null
function setNotice(kind, text, { transient = false, action = null } = {}) {
  notice.value = { kind, text, action }
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
const savedInfo = ref(null) // 存檔成功訊息 { text, sub }
const scanningImage = ref(false) // 拍照的條碼解析中
const ocrRunning = ref(false) // 後端文字辨識中（拍照或相機截圖）
const cameraRunning = ref(false) // 相機是否運作中（顯示「拍下來辨識文字」按鈕用）

// 掃描階段狀態機：右側 QR 暫存／合併、一維條碼寬限期都由它決定
let scanState = createScanSession()
let graceTimer = null // 一維條碼寬限期計時器（離開相機模式或卸載時要清）

const qrScanner = ref(null) // QrScanner 實例（start/stop）
const captureForm = ref(null) // InvoiceCaptureForm 實例（focusAmount）
const formPanel = ref(null) // 右欄 panel（手機版捲動用）

function clearGraceTimer() {
  clearTimeout(graceTimer)
  graceTimer = null
}

function switchMode(key) {
  if (mode.value === key) return
  mode.value = key
  notice.value = null
  savedInfo.value = null
  scanState = createScanSession()
  clearGraceTimer()
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

// 左側 QR：號碼、日期、金額、隨機碼、統編、品目一次補齊；rightItems = 要一併合併的右側品目
function applyLeftQr(parsed, rightItems = []) {
  const merged = rightItems.length > 0 ? mergeItems(parsed, { items: rightItems }) : parsed
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

// 右側 QR 品目合併進已有左側資料的表單（scanSession 保證同一個只會送一次）
function mergeRightItems(parsed) {
  const items = parsed.items || []
  if (items.length) form.value = { ...form.value, items: [...(form.value.items || []), ...items] }
  setNotice('info', `已合併右側 QR Code 的 ${items.length} 項品目`)
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

// 執行 scanSession 排出來的動作（一維條碼要不要等寬限期已由 handleScanTexts 決定）
function runScanActions(actions) {
  for (const action of actions || []) {
    switch (action.action) {
      case 'apply-left':
        clearGraceTimer()
        applyLeftQr(action.parsed, action.rightItems)
        qrScanner.value?.stop()
        break
      case 'merge-right':
        mergeRightItems(action.parsed)
        break
      case 'store-right':
        if (mode.value === 'photo') {
          // 拍照只有一張圖，訊息不能一下下就消失
          setNotice('warn', '只讀到右側 QR Code（沒有金額）。請把左側 QR Code 拍清楚再試一次，或改用手動補登。', {
            action: 'manual'
          })
        } else {
          // 相機繼續掃，不停下來
          setNotice('info', '這是右側 QR Code，請對準發票左側的 QR Code', { transient: true })
        }
        break
      case 'barcode-grace':
        setNotice('info', '讀到一維條碼，正在找左側 QR Code（含金額）…')
        armGraceTimer(action.deadline)
        break
      case 'apply-barcode':
        applyBarcode(action.parsed)
        qrScanner.value?.stop()
        break
      default:
        // 相機一直解到無法辨識的條碼時只短暫提示，不洗版
        setNotice('warn', '無法辨識的條碼，請對準發票上的條碼', { transient: true })
    }
  }
}

// 相機解碼回來的一張畫面（文字陣列）
function onDecoded(texts) {
  const actions = handleScanTexts(scanState, texts, Date.now(), { hasLeftData: form.value.source === 'qr' })
  runScanActions(actions)
}

// 一維條碼寬限期到點：還沒等到左側 QR 就用條碼結果
function armGraceTimer(deadline) {
  clearTimeout(graceTimer)
  const delay = Math.max(0, deadline - Date.now())
  graceTimer = setTimeout(onGraceTick, delay)
}

function onGraceTick() {
  graceTimer = null
  const action = scanTick(scanState, Date.now())
  if (action) runScanActions([action])
}

// 拍照・上傳：先解條碼；有左 QR 走原流程，否則自動改用後端 OCR 讀文字
async function onImageChange(e) {
  const file = e.target.files?.[0]
  e.target.value = '' // 允許重選同一張
  if (!file) return
  scanningImage.value = true
  notice.value = null
  savedInfo.value = null
  let found = { leftQr: null, barcode: null, rightQr: null }
  try {
    const texts = await scanImageFile(file)
    found = classifyScanTexts(texts)
    if (found.leftQr) {
      const actions = handleScanTexts(scanState, texts, Date.now(), { hasLeftData: form.value.source === 'qr' })
      runScanActions(actions)
      return
    }
  } catch {
    // 條碼解析失敗也繼續試 OCR（圖讀不出來才會在 OCR 那邊報錯）
  } finally {
    scanningImage.value = false
  }
  // 沒有左側 QR（只有一維條碼／右側 QR／什麼都沒有）：先 OCR，失敗才退回條碼
  await runOcrFlow(file, { barcode: found.barcode, rightQr: found.rightQr })
}

// 共用的 OCR 流程（拍照與相機截圖都用這個）
async function runOcrFlow(image, { barcode = null, rightQr = null } = {}) {
  ocrRunning.value = true
  setNotice('info', '條碼讀不到，改用文字辨識中…')
  try {
    const ocr = await recognizeInvoiceText(image)
    const built = buildOcrForm({ ocr, barcode, rightQr, today: todayInTaipei() })
    if (!built.ok) {
      setNotice('error', '找不到可讀的發票條碼。電子發票請先把發票攤平（摺痕會讓 QR Code 變形），正對發票拍近一點、對焦清楚；傳統發票沒有條碼，請改用手動補登。', {
        action: 'manual'
      })
      return
    }
    applyOcrForm(built)
  } catch (err) {
    // OCR 失敗但同一張圖有一維條碼：至少有號碼和隨機碼，退回條碼
    if (barcode) {
      applyBarcode(barcode)
      return
    }
    if (err instanceof NetworkError) {
      setNotice('error', '目前連不到伺服器，無法文字辨識，請改用手動補登', { action: 'manual' })
    } else if (err instanceof ApiError && err.status === 503) {
      setNotice('error', '伺服器沒有開啟文字辨識，請改用手動補登', { action: 'manual' })
    } else {
      setNotice('error', '文字辨識失敗，請重試或改用手動補登。', { action: 'manual' })
    }
  } finally {
    ocrRunning.value = false
  }
}

// 用 OCR 合併結果填表單，提示缺少／推測的欄位並聚焦第一個缺的
function applyOcrForm({ fields, missing, guessed }) {
  form.value = { ...form.value, kind: 'invoice', ...fields }
  vibrate()
  const parts = [
    fields.number
      ? `已用文字辨識讀取發票 ${formatInvoiceNumber(normalizeInvoiceNumber(fields.number))}，請核對內容`
      : '已用文字辨識讀取發票，請核對內容'
  ]
  if (missing.length) parts.push(`沒讀到：${missing.join('、')}，請手動補上`)
  if (guessed.length) parts.push(`${guessed.join('、')}是推測的，請確認`)
  setNotice('warn', parts.join('；'))
  scrollFormIntoView()
  nextTick(() => {
    if (missing.includes('號碼')) captureForm.value?.focusNumber()
    else if (missing.includes('金額')) captureForm.value?.focusAmount()
  })
}

// 相機模式「讀不到？拍下來辨識文字」：截圖 → 停相機 → OCR
// （寬限期中的一維條碼與暫存的右側 QR 品目一起合併進去）
async function captureAndOcr() {
  if (!qrScanner.value || ocrRunning.value || scanningImage.value) return
  const frame = await qrScanner.value.captureFrame()
  await qrScanner.value.stop()
  cameraRunning.value = false
  clearGraceTimer()
  const barcode = scanState.pendingBarcode
  const rightQr = scanState.pendingRightQr
  // 已帶進 OCR 的暫存清掉，避免殘留到下一張發票被錯誤合併
  scanState.pendingBarcode = null
  scanState.pendingRightQr = null
  if (!frame) {
    setNotice('warn', '相機還沒準備好，請等畫面出現再試一次', { transient: true })
    return
  }
  await runOcrFlow(frame, { barcode, rightQr })
}

// 表單存檔完成：顯示成功訊息並清空表單
function onSaved(payload) {
  scanState = createScanSession() // 下一張發票重新開始
  clearGraceTimer()
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
  scanState = createScanSession()
  qrScanner.value?.start()
}

onBeforeUnmount(() => {
  clearTimeout(noticeTimer)
  clearGraceTimer()
})

// 最近登錄（ledger.invoices 已依日期新到舊排序）
const recentInvoices = computed(() => ledger.invoices.slice(0, 5))

const SOURCE_META = {
  qr: { icon: QrCode, label: 'QR Code 掃描' },
  barcode: { icon: Barcode, label: '一維條碼' },
  ocr: { icon: ScanText, label: '文字辨識' },
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
        <QrScanner
          ref="qrScanner"
          @decoded="onDecoded"
          @switch-photo="switchMode('photo')"
          @running="cameraRunning = $event"
        />
        <!-- QR 讀不到時的救濟：把目前畫面拍下來送後端文字辨識 -->
        <button
          v-if="cameraRunning && !ocrRunning"
          type="button"
          class="btn-secondary ocr-capture"
          @click="captureAndOcr"
        >
          <ScanText :size="15" /> 讀不到？拍下來辨識文字
        </button>
        <p v-if="notice" class="inline-notice" :class="notice.kind">{{ notice.text }}</p>
      </template>

      <template v-else-if="mode === 'photo'">
        <h2 class="scanner-section-title"><ImageUp :size="18" /> 拍照・上傳圖片</h2>
        <p class="scanner-intro">先把發票攤平（摺痕會讓 QR Code 變形而讀不出來），手機正對發票、拍近一點，讓左下角的 QR Code 清楚對焦、避免反光。會自動解析 QR Code 與一維條碼；沒有 HTTPS 也能用。</p>
        <label class="photo-drop" :class="{ busy: scanningImage || ocrRunning }">
          <input type="file" accept="image/*" capture="environment" hidden @change="onImageChange" />
          <span class="scan-frame">
            <span class="corner tl"></span>
            <span class="corner tr"></span>
            <span class="corner bl"></span>
            <span class="corner br"></span>
            <ImageUp :size="38" stroke-width="1.3" />
          </span>
          <b>{{ ocrRunning ? '文字辨識中…' : scanningImage ? '解析中…' : '拍照或選擇圖片' }}</b>
          <span class="photo-hint">手機上會直接開啟相機</span>
        </label>
        <p v-if="notice" class="inline-notice" :class="notice.kind">
          {{ notice.text }}
          <button
            v-if="notice.action === 'manual'"
            type="button"
            class="btn-secondary notice-action"
            @click="switchMode('manual')"
          >
            <Keyboard :size="14" /> 改用手動補登
          </button>
        </p>
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
