<script setup>
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { Plus, ArrowRight } from 'lucide-vue-next'
import { Bar, Doughnut } from 'vue-chartjs'
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement } from 'chart.js'
import StatCard from '../components/StatCard.vue'
import { useLedgerStore } from '../stores/ledger'
import { money, percent } from '../utils/format'
import { monthKey, monthLabel, monthSummary, monthlyTrend, findPeak, compareWithPrevious, addMonths } from '../utils/stats'
import { todayInTaipei } from '../utils/period'
import { categoryColor } from '../constants'

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement)

const ledger = useLedgerStore()
const transactions = computed(() => ledger.transactions)
const invoices = computed(() => ledger.invoices)

// 月份切換：預設本月，不能切到未來
const currentMonth = monthKey(todayInTaipei())
const month = ref(currentMonth)
const monthTitle = computed(() => `${month.value.slice(0, 4)}年${Number(month.value.slice(5, 7))}月`)
const canNext = computed(() => month.value < currentMonth)
function shiftMonth(delta) {
  const next = addMonths(month.value, delta)
  if (next <= currentMonth) month.value = next
}

// 本月摘要與上月比較
const summary = computed(() => monthSummary(transactions.value, month.value))
const comparison = computed(() => compareWithPrevious(transactions.value, month.value))
const expenseHint = computed(() => {
  const change = comparison.value.expense.change
  if (change === null) return '上月無支出'
  return `比上月 ${change >= 0 ? '+' : ''}${percent(change)}`
})
const incomeHint = computed(() =>
  month.value === currentMonth ? '本月累計收入' : '該月累計收入'
)
const invoiceCount = computed(
  () => invoices.value.filter((i) => monthKey(i.date) === month.value).length
)

// 統計卡標題：本月用「本月…」，其他月份用「10月收入」這種格式
const statLabels = computed(() =>
  month.value === currentMonth
    ? { income: '本月總收入', expense: '本月總支出', balance: '本月結餘', invoice: '本月發票' }
    : {
        income: `${monthLabel(month.value)}收入`,
        expense: `${monthLabel(month.value)}支出`,
        balance: `${monthLabel(month.value)}結餘`,
        invoice: `${monthLabel(month.value)}發票`
      }
)

// 支出分類圓餅圖
const doughnutData = computed(() => ({
  labels: summary.value.byCategory.map((c) => c.category),
  datasets: [
    {
      data: summary.value.byCategory.map((c) => c.amount),
      backgroundColor: summary.value.byCategory.map((c) => categoryColor(c.category)),
      borderWidth: 0,
      hoverOffset: 5
    }
  ]
}))

const doughnutOptions = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '70%',
  plugins: { legend: { display: false } }
}

// 收支趨勢（6 / 12 個月可切換）與開銷高峰
const trendMonths = ref(6)
const trend = computed(() => monthlyTrend(transactions.value, month.value, trendMonths.value))
const peak = computed(() => findPeak(trend.value))
const trendData = computed(() => ({
  labels: trend.value.map((row) => row.label),
  datasets: [
    {
      label: '收入',
      data: trend.value.map((row) => row.income),
      backgroundColor: '#6558e8',
      borderRadius: 5,
      barPercentage: 0.52
    },
    {
      label: '支出',
      data: trend.value.map((row) => row.expense),
      backgroundColor: trend.value.map((row) =>
        peak.value && row.month === peak.value.month ? '#f3a76b' : '#c5c0fa'
      ),
      borderRadius: 5,
      barPercentage: 0.52
    }
  ]
}))
const peakNote = computed(() =>
  peak.value
    ? `開銷高峰：${peak.value.label} ${money(peak.value.amount)}，比平均高 ${percent(peak.value.vsAverage)}`
    : ''
)

const barOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom',
      labels: { usePointStyle: true, boxWidth: 7, padding: 18 }
    }
  },
  scales: {
    x: { grid: { display: false }, border: { display: false } },
    y: {
      grid: { color: '#f0f0f6' },
      border: { display: false },
      // 沒有資料時至少畫到 1,000，避免出現 0.001k 這種刻度
      suggestedMax: 1000,
      ticks: { precision: 0, callback: (v) => (v >= 1000 ? `${v / 1000}k` : v) }
    }
  }
}

// 最近 5 筆（ledger 已依日期新到舊排序）
const recent = computed(() => transactions.value.slice(0, 5))
</script>

<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow purple">FINANCIAL OVERVIEW</div>
      <h1>早安，今天也要好好記帳！ <span class="wave">✦</span></h1>
      <p>這是你的財務概況，讓我們一起掌握每一分錢。</p>
    </div>
    <div class="heading-actions">
      <div class="month-switch">
        <button type="button" title="上個月" @click="shiftMonth(-1)">‹</button>
        <b>{{ monthTitle }}</b>
        <button type="button" title="下個月" :disabled="!canNext" @click="shiftMonth(1)">›</button>
      </div>
      <RouterLink class="btn-primary" to="/transactions?new=1"><Plus :size="17" /> 新增一筆</RouterLink>
    </div>
  </div>
  <div class="stats-grid">
    <StatCard :label="statLabels.income" :value="money(summary.income)" :hint="incomeHint" icon="↗" tone="mint" />
    <StatCard :label="statLabels.expense" :value="money(summary.expense)" :hint="expenseHint" icon="↘" tone="peach" />
    <StatCard :label="statLabels.balance" :value="money(summary.balance)" hint="收入 − 支出" icon="◈" tone="purple" />
    <StatCard :label="statLabels.invoice" :value="`${invoiceCount} 張`" hint="該月開立的發票" icon="▤" tone="blue" />
  </div>
  <div class="dashboard-grid">
    <section class="panel trend-panel">
      <div class="panel-heading">
        <div>
          <h3>收支趨勢</h3>
          <p>每月收入與支出比較</p>
        </div>
        <div class="trend-range">
          <button type="button" :class="{ active: trendMonths === 6 }" @click="trendMonths = 6">近 6 個月</button>
          <button type="button" :class="{ active: trendMonths === 12 }" @click="trendMonths = 12">近 12 個月</button>
        </div>
      </div>
      <div class="chart-area">
        <Bar :data="trendData" :options="barOptions" />
      </div>
      <p v-if="peakNote" class="peak-note">{{ peakNote }}</p>
    </section>
    <section class="panel category-panel">
      <div class="panel-heading">
        <div>
          <h3>支出分類</h3>
          <p>本月消費分布</p>
        </div>
        <RouterLink class="text-link" to="/transactions">查看明細 <ArrowRight :size="14" /></RouterLink>
      </div>
      <template v-if="summary.expense > 0">
        <div class="doughnut-wrap">
          <Doughnut :data="doughnutData" :options="doughnutOptions" />
          <div class="doughnut-center">
            <small>本月支出</small>
            <b>{{ money(summary.expense) }}</b>
          </div>
        </div>
        <div class="legend-list">
          <div v-for="row in summary.byCategory" :key="row.category" class="legend-row">
            <span class="legend-dot" :style="{ background: categoryColor(row.category) }"></span>
            <span>{{ row.category }}</span>
            <small class="legend-ratio">{{ percent(row.ratio) }}</small>
            <b>{{ money(row.amount) }}</b>
          </div>
        </div>
      </template>
      <div v-else class="chart-empty">這個月份還沒有支出，新增後就會顯示分類分布。</div>
    </section>
  </div>
  <section class="panel recent-panel">
    <div class="panel-heading">
      <div>
        <h3>最近交易</h3>
        <p>查看最新的收支紀錄</p>
      </div>
      <RouterLink class="text-link" to="/transactions">全部交易 <ArrowRight :size="14" /></RouterLink>
    </div>
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>項目</th>
            <th>分類</th>
            <th>日期</th>
            <th>類型</th>
            <th class="align-right">金額</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in recent" :key="t.id">
            <td>
              <span class="transaction-title">
                <span
                  class="transaction-badge"
                  :class="t.type"
                >{{ t.type === 'income' ? '↗' : '↘' }}</span>{{ t.title }}</span>
            </td>
            <td><span class="category-chip">{{ t.category }}</span></td>
            <td>{{ t.date }}</td>
            <td><span class="type-label" :class="t.type">{{ t.type === 'income' ? '收入' : '支出' }}</span></td>
            <td
              class="align-right amount-cell"
              :class="t.type"
            >{{ t.type === 'income' ? '+' : '−' }}{{ money(t.amount) }}</td>
          </tr>
          <tr v-if="!recent.length">
            <td colspan="5" class="empty-state">尚無交易紀錄，新增一筆開始記帳吧。</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
