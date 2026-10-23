<script setup>
// 相機掃描元件：html5-qrcode 掃 QR Code 與 Code 39（一維條碼）。
// 不自動開相機；由使用者按「開啟相機」，父元件可用 start()/stop() 控制。
import { onBeforeUnmount, ref, useId } from 'vue'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { Camera, CameraOff, CircleX, ImageUp, LoaderCircle, ScanLine } from 'lucide-vue-next'

const emit = defineEmits(['decoded', 'error', 'switch-photo'])

// html5-qrcode 綁定 DOM id，要保證唯一（useId 去掉特殊字元當後綴）
const elementId = `rw-qr-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

const state = ref('idle') // idle / starting / running / error
const errorMsg = ref('')

// getUserMedia 只能在 HTTPS 或 localhost 用；不安全的環境不顯示開相機按鈕
const cameraAvailable =
  typeof window !== 'undefined' &&
  !!window.isSecureContext &&
  !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)

let scanner = null
let stopRequested = false // 啟動中途被要求停止時，start() 完成後補停

// 掃描方框：依觀景窗尺寸取正方形（留邊讓使用者對準）
function qrboxSize(viewfinderWidth, viewfinderHeight) {
  const size = Math.max(140, Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.75))
  return { width: size, height: size }
}

function friendlyError(err) {
  const name = err?.name || String(err)
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return '相機權限被拒絕，請到瀏覽器設定允許使用相機。'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return '找不到相機。'
  if (name === 'NotReadableError') return '相機被其他應用程式使用中，請關閉後再試。'
  return '相機啟動失敗，請重試或改用「拍照・上傳圖片」。'
}

// 同一段文字 2 秒內重複解碼只回報一次
let lastText = ''
let lastDecodedAt = 0
function onDecodeSuccess(text) {
  const now = Date.now()
  if (text === lastText && now - lastDecodedAt < 2000) return
  lastText = text
  lastDecodedAt = now
  emit('decoded', text)
}

async function start() {
  if (state.value === 'running' || state.value === 'starting') return
  if (!cameraAvailable) {
    errorMsg.value = '相機需要 HTTPS 或 localhost 才能使用。'
    state.value = 'error'
    emit('error', errorMsg.value)
    return
  }
  state.value = 'starting'
  errorMsg.value = ''
  stopRequested = false
  try {
    if (!scanner) {
      scanner = new Html5Qrcode(elementId, {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE, Html5QrcodeSupportedFormats.CODE_39],
        useBarCodeDetectorIfSupported: true,
        verbose: false
      })
    }
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: qrboxSize },
      (text) => onDecodeSuccess(text),
      () => {} // 每幀解不出來都會呼叫，忽略
    )
    if (stopRequested) {
      // 啟動期間被要求停止（例如掃到結果或切換分頁），補停一次避免相機沒關
      await stop()
      return
    }
    state.value = 'running'
  } catch (err) {
    state.value = 'error'
    errorMsg.value = friendlyError(err)
    emit('error', errorMsg.value)
  }
}

async function stop() {
  stopRequested = true
  if (scanner) {
    try {
      await scanner.stop() // 還沒啟動時呼叫會丟例外
      await scanner.clear()
    } catch {
      // 尚未啟動或已停止，忽略
    }
  }
  if (state.value !== 'error') state.value = 'idle'
}

onBeforeUnmount(stop)

defineExpose({ start, stop })
</script>

<template>
  <div class="qr-wrap">
    <!-- 不安全的環境（例如手機用 http 區網網址開啟）改引導到拍照模式 -->
    <div v-if="!cameraAvailable" class="camera-unavailable">
      <CameraOff :size="26" />
      <p>相機需要 HTTPS 或 localhost 才能使用。手機用區網網址開啟時，請改用「拍照・上傳圖片」。</p>
      <button type="button" class="btn-secondary" @click="emit('switch-photo')">
        <ImageUp :size="15" /> 拍照・上傳圖片
      </button>
    </div>

    <template v-else>
      <div class="qr-stage" :class="{ running: state === 'running' }">
        <div :id="elementId" class="qr-view"></div>
        <span v-if="state !== 'running'" class="qr-idle" aria-hidden="true">
          <ScanLine :size="34" stroke-width="1.4" />
        </span>
        <div v-if="state === 'running'" class="qr-corners" aria-hidden="true">
          <div class="qr-box">
            <span class="corner tl"></span>
            <span class="corner tr"></span>
            <span class="corner bl"></span>
            <span class="corner br"></span>
          </div>
        </div>
      </div>

      <p v-if="state === 'error' && errorMsg" class="qr-error"><CircleX :size="15" /> {{ errorMsg }}</p>

      <div class="qr-actions">
        <button
          v-if="state !== 'running'"
          type="button"
          class="btn-primary"
          :disabled="state === 'starting'"
          @click="start"
        >
          <LoaderCircle v-if="state === 'starting'" :size="16" class="spin" />
          <Camera v-else :size="16" />
          {{ state === 'starting' ? '相機啟動中…' : '開啟相機' }}
        </button>
        <button v-else type="button" class="btn-secondary" @click="stop">
          <CircleX :size="15" /> 關閉相機
        </button>
      </div>

      <p class="qr-tip">對準發票左下角的 QR Code 可一次帶入號碼、日期與金額；也可以掃右側 QR Code 或一維條碼。</p>
    </template>
  </div>
</template>
