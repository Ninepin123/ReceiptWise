<script setup>
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import {
  ArrowUpRight, ArrowDownRight, Wallet, TrendingUp, ReceiptText, Plus, ArrowRight, CircleHelp
} from 'lucide-vue-next'
import { Bar, Doughnut } from 'vue-chartjs'
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement } from 'chart.js'
import StatCard from '../components/StatCard.vue'
import { getTransactions, getInvoices, money } from '../api'

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement)

const transactions = computed(() => getTransactions())
const invoices = computed(() => getInvoices())
const month = '2026-10'

const current = computed(() => transactions.value.filter(t => t.date.startsWith(month)))
const income = computed(() =>
  current.value.filter(t => t.type === 'income').reduce((s,t) => s + Number(t.amount),0)
)
const expense = computed(() =>
  current.value.filter(t => t.type === 'expense').reduce((s,t) => s + Number(t.amount),0)
)
const balance = computed(() => income.value - expense.value)

const categoryTotals = computed(() => {
  const totals = {}
  current.value
    .filter(t => t.type === 'expense')
    .forEach(t => totals[t.category] = (totals[t.category] || 0) + Number(t.amount))
  return totals
})

const doughnutData = computed(() => ({
  labels: Object.keys(categoryTotals.value),
  datasets: [{
    data: Object.values(categoryTotals.value),
    backgroundColor: ['#6558e8','#8d83f2','#b3adfa','#f3a76b','#62c5b4','#e58bb4'],
    borderWidth: 0,
    hoverOffset: 5
  }]
}))

const doughnutOptions = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '70%',
  plugins: { legend: { display: false } }
}

const trendData = {
  labels: ['5月','6月','7月','8月','9月','10月'],
  datasets: [
    {
      label: '收入',
      data: [28000,32000,30000,36000,34000, income.value || 9500],
      backgroundColor: '#6558e8',
      borderRadius: 5,
      barPercentage: .52
    },
    {
      label: '支出',
      data: [18000,21000,19500,24000,22500, expense.value || 1620],
      backgroundColor: '#c5c0fa',
      borderRadius: 5,
      barPercentage: .52
    }
  ]
}

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
      ticks: { callback: v => '$' + (v/1000) + 'k' }
    }
  }
}

const recent = computed(() =>
  [...transactions.value].sort((a,b) => b.date.localeCompare(a.date)).slice(0,5)
)
</script>

<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow purple">FINANCIAL OVERVIEW</div>
      <h1>早安，今天也要好好記帳！ <span class="wave">✦</span></h1>
      <p>這是你的財務概況，讓我們一起掌握每一分錢。</p>
    </div>
    <RouterLink class="btn-primary" to="/transactions"><Plus :size="17" /> 新增一筆</RouterLink>
  </div>
  <div class="notice-strip">
    <span class="notice-icon"><CircleHelp :size="17" /></span>
    <span>目前為前端展示版本，圖表使用本機示範資料；尚未連接後端。</span>
    <RouterLink to="/settings">了解更多 <ArrowRight :size="14" /></RouterLink>
  </div>
  <div class="stats-grid">
    <StatCard label="本月總收入" :value="money(income)" hint="本月累計收入" icon="↗" tone="mint" />
    <StatCard label="本月總支出" :value="money(expense)" hint="本月累計支出" icon="↘" tone="peach" />
    <StatCard label="本月結餘" :value="money(balance)" hint="收入 − 支出" icon="◈" tone="purple" />
    <StatCard label="已整理發票" :value="`${invoices.length} 張`" hint="本機保存的發票" icon="▤" tone="blue" />
  </div>
  <div class="dashboard-grid">
    <section class="panel trend-panel">
      <div class="panel-heading">
        <div>
          <h3>收支趨勢</h3>
          <p>每月收入與支出比較</p>
        </div>
        <span class="select-static">近 6 個月⌄</span>
      </div>
      <div class="chart-area">
        <Bar :data="trendData" :options="barOptions" />
      </div>
    </section>
    <section class="panel category-panel">
      <div class="panel-heading">
        <div>
          <h3>支出分類</h3>
          <p>本月消費分布</p>
        </div>
        <RouterLink class="text-link" to="/transactions">查看明細 <ArrowRight :size="14" /></RouterLink>
      </div>
      <div class="doughnut-wrap">
        <Doughnut :data="doughnutData" :options="doughnutOptions" />
        <div class="doughnut-center">
          <small>本月支出</small>
          <b>{{ money(expense) }}</b>
        </div>
      </div>
      <div class="legend-list">
        <div v-for="(amount, category, i) in categoryTotals" :key="category" class="legend-row">
          <span
            class="legend-dot"
            :style="{ background: ['#6558e8','#8d83f2','#b3adfa','#f3a76b','#62c5b4','#e58bb4'][i % 6] }"
          ></span>
          <span>{{ category }}</span>
          <b>{{ money(amount) }}</b>
        </div>
        <div v-if="!Object.keys(categoryTotals).length" class="empty-mini">新增支出後就會顯示分類</div>
      </div>
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
