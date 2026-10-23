<script setup>
// 發票對獎頁：獎號由後端從財政部 RSS 代抓，一鍵對獎並顯示結果。
import { computed, onMounted, ref, watch } from 'vue'
import {
  Sparkles,
  RefreshCw,
  CalendarClock,
  ChevronDown,
  CircleHelp,
  CheckCircle2,
  XCircle,
  Clock,
  ScanLine,
  Trophy,
  PartyPopper,
  AlertCircle
} from 'lucide-vue-next'
import { useLedgerStore } from '../stores/ledger'
import { useLotteryStore } from '../stores/lottery'
import { formatInvoiceNumber, money } from '../utils/format'
import { claimWindow, periodOf, todayInTaipei } from '../utils/period'
import { PRIZE_TABLE, matchedDigits, daysUntil, groupInvoicesByStatus } from '../utils/lottery'

const lottery = useLotteryStore()
const ledger = useLedgerStore()

const selectedPeriod = ref('')
const rulesOpen = ref(false)

onMounted(() => {
  if (!lottery.draws.length) lottery.fetchDraws()
})

// 期別標籤預設選最新一期；重新抓到獎號後若目前選擇不存在就回到最新
watch(
  () => lottery.draws,
  (draws) => {
    if (draws.length && !draws.some((d) => d.period === selectedPeriod.value)) {
      selectedPeriod.value = draws[0].period
    }
  },
  { immediate: true }
)

const selectedDraw = computed(
  () => lottery.draws.find((d) => d.period === selectedPeriod.value) ?? lottery.draws[0] ?? null
)

// 下次開獎卡片：標籤、日期與倒數天數
const nextDrawInfo = computed(() => {
  const nd = lottery.nextDraw
  if (!nd) return null
  const days = daysUntil(nd.drawDate, todayInTaipei())
  return {
    ...nd,
    date: formatDate(nd.drawDate),
    countdown: days === 0 ? '今天開獎' : days > 0 ? `還有 ${days} 天` : '已開獎'
  }
})

// 本期（今天所屬期別）已登錄的發票張數
const currentPeriodCount = computed(
  () => ledger.invoices.filter((i) => i.period === periodOf(todayInTaipei())).length
)

// 選擇期別的發票，依對獎狀態分組
const periodInvoices = computed(() =>
  ledger.invoices.filter((i) => i.period === selectedPeriod.value)
)
const grouped = computed(() => groupInvoicesByStatus(periodInvoices.value))

// 中獎卡片資料：號碼拆成字軌＋前段＋醒目的末 N 碼
const wonCards = computed(() =>
  grouped.value.won.map((inv) => {
    const number = String(inv.number ?? '')
    const n = matchedDigits(inv.prizeName)
    const digits = number.slice(2) // 8 碼數字
    const win = claimWindow(inv.period)
    return {
      ...inv,
      track: number.slice(0, 2),
      plain: digits.slice(0, Math.max(digits.length - n, 0)),
      matched: n > 0 ? digits.slice(-n) : '',
      claim: `${formatDate(win.start)} ~ ${formatDate(win.end)}`
    }
  })
)

function formatDate(dateStr) {
  return String(dateStr ?? '').replaceAll('-', '/')
}

function formatTime(iso) {
  return iso ? new Date(iso).toLocaleString('zh-TW', { hour12: false }) : ''
}
</script>

<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow purple">INVOICE LOTTERY</div>
      <h1>發票對獎</h1>
      <p>獎號來自財政部，登錄的發票一鍵對獎。</p>
    </div>
    <div class="heading-actions">
      <button class="btn-primary" :disabled="lottery.checking" @click="lottery.checkNow()">
        <RefreshCw v-if="lottery.checking" :size="15" class="btn-spin" />
        <Sparkles v-else :size="15" />
        {{ lottery.checking ? '處理中…' : '立即對獎' }}
      </button>
    </div>
  </div>

  <!-- 對獎結果；有新中獎時用金色醒目樣式 -->
  <div
    v-if="lottery.lastCheck"
    class="notice-strip"
    :class="lottery.lastCheck.newWins.length ? 'check-result-win' : 'check-result'"
  >
    <span class="notice-icon">
      <PartyPopper v-if="lottery.lastCheck.newWins.length" :size="16" />
      <CheckCircle2 v-else :size="16" />
    </span>
    <span>
      已對獎 {{ lottery.lastCheck.checked }} 張：中獎 {{ lottery.lastCheck.summary.won }} 張、未中獎
      {{ lottery.lastCheck.summary.notWon }} 張、待開獎 {{ lottery.lastCheck.summary.pending }} 張
    </span>
  </div>

  <!-- 對獎失敗但獎號還在時，只顯示小提示 -->
  <div v-if="lottery.error && lottery.draws.length" class="notice-strip check-error">
    <span class="notice-icon"><AlertCircle :size="16" /></span>
    <span>{{ lottery.error }}</span>
  </div>

  <!-- 第一次載入中 -->
  <div v-if="lottery.loading && !lottery.draws.length" class="panel lottery-state">
    <RefreshCw :size="17" class="btn-spin" /> 正在取得統一發票獎號…
  </div>

  <!-- 獎號完全抓不到 -->
  <div v-else-if="lottery.error && !lottery.draws.length" class="panel lottery-state lottery-state-error">
    <AlertCircle :size="20" />
    <p>{{ lottery.error }}</p>
    <button class="btn-secondary" @click="lottery.fetchDraws()"><RefreshCw :size="14" /> 重試</button>
  </div>

  <template v-else-if="selectedDraw">
    <!-- 下次開獎 -->
    <div v-if="nextDrawInfo" class="next-draw-card">
      <div class="next-draw-icon"><CalendarClock :size="20" /></div>
      <div class="next-draw-copy">
        <span class="next-draw-label">下次開獎</span>
        <b>{{ nextDrawInfo.label }} · {{ nextDrawInfo.date }}</b>
      </div>
      <span class="next-draw-countdown" :class="{ today: nextDrawInfo.countdown === '今天開獎' }">
        {{ nextDrawInfo.countdown }}
      </span>
      <div class="next-draw-side">
        <span>本期已登錄</span>
        <b>{{ currentPeriodCount }} 張發票</b>
      </div>
    </div>

    <!-- 期別標籤（橫向捲動） -->
    <div class="period-tabs">
      <button
        v-for="d in lottery.draws"
        :key="d.period"
        type="button"
        class="period-tab"
        :class="{ active: d.period === selectedPeriod }"
        @click="selectedPeriod = d.period"
      >
        {{ d.label }}
      </button>
    </div>

    <div class="lottery-layout">
      <!-- 該期獎號 -->
      <section class="panel">
        <div class="panel-heading">
          <div>
            <h3>本期獎號</h3>
            <p>{{ selectedDraw.label }} · {{ formatDate(selectedDraw.drawDate) }} 開獎</p>
          </div>
          <small v-if="lottery.lastFetchedAt" class="draw-updated">
            資料更新 {{ formatTime(lottery.lastFetchedAt) }}
          </small>
        </div>

        <div class="draw-number-row special">
          <div class="draw-number-label"><b>特別獎</b><small>{{ money(10000000) }}</small></div>
          <span class="draw-number">{{ selectedDraw.special }}</span>
        </div>
        <div class="draw-number-row grand">
          <div class="draw-number-label"><b>特獎</b><small>{{ money(2000000) }}</small></div>
          <span class="draw-number">{{ selectedDraw.grand }}</span>
        </div>
        <div class="draw-number-row first">
          <div class="draw-number-label"><b>頭獎</b><small>3 組 · 各 {{ money(200000) }}</small></div>
          <div class="draw-first-list">
            <span v-for="num in selectedDraw.first" :key="num" class="draw-number draw-number-sm">{{ num }}</span>
          </div>
        </div>

        <!-- 對獎規則（可收合） -->
        <div class="rules-section">
          <button type="button" class="rules-toggle" @click="rulesOpen = !rulesOpen">
            <CircleHelp :size="14" /> 對獎規則
            <ChevronDown :size="14" class="rules-chevron" :class="{ open: rulesOpen }" />
          </button>
          <div v-show="rulesOpen" class="rules-table-wrap">
            <table class="rules-table">
              <thead>
                <tr><th>獎別</th><th>條件</th><th>獎金</th></tr>
              </thead>
              <tbody>
                <tr v-for="p in PRIZE_TABLE" :key="p.name">
                  <td><b>{{ p.name }}</b></td>
                  <td>{{ p.rule }}</td>
                  <td class="amount">{{ money(p.amount) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- 我的發票（該期） -->
      <section class="panel">
        <div class="panel-heading">
          <div>
            <h3>我的發票</h3>
            <p>{{ selectedDraw.label }} · 共 {{ periodInvoices.length }} 張</p>
          </div>
        </div>

        <!-- 中獎 -->
        <div v-if="wonCards.length">
          <div class="my-section-title win">
            <Trophy :size="14" /> 中獎 <span class="count">{{ wonCards.length }}</span>
          </div>
          <div class="win-card-list">
            <div v-for="inv in wonCards" :key="inv.id" class="win-card">
              <div class="win-card-top">
                <span class="win-prize-chip">{{ inv.prizeName }}</span>
                <b class="win-amount">{{ money(inv.prizeAmount) }}</b>
              </div>
              <div class="win-number">
                {{ inv.track }}-{{ inv.plain }}<span class="win-digits">{{ inv.matched }}</span>
              </div>
              <div class="win-meta">{{ inv.seller || '未填寫店家' }} · {{ formatDate(inv.date) }}</div>
              <div class="win-claim">領獎期間：{{ inv.claim }}（以財政部公告為準）</div>
            </div>
          </div>
        </div>

        <!-- 未中獎：精簡清單 -->
        <div v-if="grouped.notWon.length">
          <div class="my-section-title muted">
            <XCircle :size="14" /> 未中獎 <span class="count">{{ grouped.notWon.length }}</span>
          </div>
          <div class="plain-invoice-list">
            <div v-for="inv in grouped.notWon" :key="inv.id" class="plain-invoice-row">
              <span class="plain-number">{{ formatInvoiceNumber(inv.number) }}</span>
              <span class="plain-seller">{{ inv.seller || '未填寫店家' }}</span>
              <small>{{ formatDate(inv.date) }}</small>
            </div>
          </div>
        </div>

        <!-- 待對獎：該期已開獎但還是 pending -->
        <div v-if="grouped.pending.length" class="pending-hint">
          <Clock :size="16" />
          <span>此期有 {{ grouped.pending.length }} 張發票尚未對獎，按「立即對獎」更新結果。</span>
        </div>

        <!-- 空狀態 -->
        <div v-if="!periodInvoices.length" class="lottery-empty">
          <div class="lottery-empty-icon"><ScanLine :size="28" /></div>
          <b>此期還沒有發票</b>
          <p>掃描或手動登錄發票後，這裡會顯示對獎結果。</p>
          <router-link to="/scanner" class="btn-secondary lottery-scan-link">
            <ScanLine :size="14" /> 掃描發票
          </router-link>
        </div>
      </section>
    </div>

    <p class="lottery-disclaimer">獎號來源：財政部稅務入口網。中獎結果僅供參考，請以財政部公告為準。</p>
  </template>
</template>
