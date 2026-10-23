<script setup>
import { useAuthStore } from '../stores/auth'
import { Database, ShieldCheck, MonitorSmartphone, Info, RotateCcw } from 'lucide-vue-next'

const auth = useAuthStore()

function resetDemo() {
  if (confirm('確定清除本瀏覽器中的示範收支與發票資料？此動作無法復原。')) {
    localStorage.removeItem('cloudledger-transactions')
    localStorage.removeItem('cloudledger-invoices')
    alert('已清除資料。重新進入頁面後會載入初始示範資料。')
    location.reload()
  }
}
</script>

<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow purple">PREFERENCES</div>
      <h1>系統設定</h1>
      <p>查看目前前端版本的資料儲存方式與系統資訊。</p>
    </div>
  </div>
  <div class="settings-layout">
    <section class="panel settings-panel">
      <div class="panel-heading">
        <div>
          <h3>使用者資訊</h3>
          <p>目前的示範工作階段</p>
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-icon lavender"><ShieldCheck /></div>
        <div class="setting-copy">
          <b>登入帳號</b>
          <span>目前使用前端展示登入，沒有連接後端驗證。</span>
        </div>
        <strong>{{ auth.user || '示範使用者' }}</strong>
      </div>
      <div class="setting-row">
        <div class="setting-icon mint"><Database /></div>
        <div class="setting-copy">
          <b>資料儲存</b>
          <span>收支與發票存在目前瀏覽器的 localStorage。</span>
        </div>
        <span class="status-chip">本機儲存</span>
      </div>
      <div class="setting-row">
        <div class="setting-icon peach"><MonitorSmartphone /></div>
        <div class="setting-copy">
          <b>後端 API</b>
          <span>尚未連接 Flask REST API，資料不會跨裝置同步。</span>
        </div>
        <span class="status-chip pending">未連接</span>
      </div>
    </section>
    <section class="panel settings-panel">
      <div class="panel-heading">
        <div>
          <h3>資料管理</h3>
          <p>清除目前瀏覽器的示範資料</p>
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-icon peach"><RotateCcw /></div>
        <div class="setting-copy">
          <b>重設示範資料</b>
          <span>刪除本機收支與發票資料；下次開啟時會重新建立初始資料。</span>
        </div>
        <button class="btn-secondary" @click="resetDemo">清除資料</button>
      </div>
      <div class="settings-warning">
        <Info :size="18" />
        <p>請勿將此展示版當作正式帳務系統。瀏覽器 localStorage 不具備伺服器備份、帳號隔離或正式身分驗證。</p>
      </div>
    </section>
  </div>
</template>
