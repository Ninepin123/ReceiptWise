<script setup>
// 相機掃描元件：getUserMedia 自架 video，畫面用原始解析度交給 zxing-wasm 解碼
// （電子發票的 QR Code 很密，縮成掃描框的 CSS 尺寸會解不出來）。
// 不自動開相機；由使用者按「開啟相機」，父元件可用 start()/stop() 控制。
import { onBeforeUnmount, ref, watch } from 'vue'
import {
  Camera,
  CameraOff,
  CircleX,
  Flashlight,
  FlashlightOff,
  ImageUp,
  LoaderCircle,
  ScanLine
} from 'lucide-vue-next'
import { decodeBarcodes } from '../utils/barcodeReader.js'
import { parseEInvoiceCode } from '../utils/einvoice.js'

const emit = defineEmits(['decoded', 'error', 'switch-photo', 'running'])

const videoRef = ref(null)

const state = ref('idle') // idle / starting / running / error
const errorMsg = ref('')
const torchAvailable = ref(false)
const torchOn = ref(false)

// getUserMedia 只能在 HTTPS 或 localhost 用；不安全的環境不顯示開相機按鈕
const cameraAvailable =
  typeof window !== 'undefined' &&
  !!window.isSecureContext &&
  !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)

let stream = null
let stopRequested = false // 啟動中途被要求停止時，拿到 stream 後補停
let decodeTimer = null
let decoding = false // 一次只解一張，前一張解完才排下一張
let useCropNext = false // 每隔一張改解掃描框（畫面中央）範圍，仍用原始像素
let grabCanvas = null
let nativeDetector = null // 原生 BarcodeDetector（Android Chrome 快很多），失敗就退回 zxing
let visibilityHandler = null

// 兩次解碼至少間隔這麼久，避免 CPU 被解碼吃滿、畫面卡住
const DECODE_INTERVAL_MS = 120
// 同一段文字 2 秒內重複解碼只回報一次
const DUPLICATE_WINDOW_MS = 2000
// 解碼畫面最長邊上限（通常鏡頭就是 1920，保險用）
const MAX_DECODE_DIMENSION = 1920

function friendlyError(err) {
  const name = err?.name || String(err)
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return '相機權限被拒絕，請到瀏覽器設定允許使用相機。'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return '找不到相機。'
  if (name === 'NotReadableError') return '相機被其他應用程式使用中，請關閉後再試。'
  return '相機啟動失敗，請重試或改用「拍照・上傳圖片」。'
}

// 要求高解析度（QR 很密，640×480 解不出來）；裝置不支援解析度要求時退回只指定後鏡頭
async function openCamera() {
  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    }
  }
  try {
    return await navigator.mediaDevices.getUserMedia(constraints)
  } catch (err) {
    if (err?.name === 'OverconstrainedError') {
      return await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment' } })
    }
    throw err
  }
}

function releaseStream(media) {
  for (const track of media?.getTracks?.() || []) track.stop()
}

// 開啟連續自動對焦（掃描要距離 10–15 公分，固定焦距會糊掉）；不支援就算了
function setupTrackFeatures() {
  const track = stream?.getVideoTracks?.()[0]
  if (!track) return
  const capabilities = track.getCapabilities?.() || {}
  if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes('continuous')) {
    track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {})
  }
  torchAvailable.value = capabilities.torch === true
  torchOn.value = false
}

async function toggleTorch() {
  const track = stream?.getVideoTracks?.()[0]
  if (!track) return
  try {
    await track.applyConstraints({ advanced: [{ torch: !torchOn.value }] })
    torchOn.value = !torchOn.value
  } catch {
    torchOn.value = false
  }
}

// 把影片畫面畫到 canvas 取出 ImageData。crop=true 時裁畫面中央正方形（掃描框位置），
// 但一律用影片的原始像素解析度（最長邊上限 1920），絕不縮成 CSS 尺寸。
function grabFrame(crop) {
  const video = videoRef.value
  const vw = video?.videoWidth || 0
  const vh = video?.videoHeight || 0
  if (!vw || !vh) return null
  let sx = 0
  let sy = 0
  let sw = vw
  let sh = vh
  if (crop) {
    const side = Math.round(Math.min(vw, vh) * 0.9)
    sx = Math.round((vw - side) / 2)
    sy = Math.round((vh - side) / 2)
    sw = side
    sh = side
  }
  const scale = Math.max(vw, vh) > MAX_DECODE_DIMENSION ? MAX_DECODE_DIMENSION / Math.max(vw, vh) : 1
  const dw = Math.max(1, Math.round(sw * scale))
  const dh = Math.max(1, Math.round(sh * scale))
  if (!grabCanvas) grabCanvas = document.createElement('canvas')
  grabCanvas.width = dw
  grabCanvas.height = dh
  const ctx = grabCanvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh)
  return ctx.getImageData(0, 0, dw, dh)
}

const recentTexts = new Map() // text -> 上次回報時間

// 逐筆過濾 2 秒內重複的文字，只留下第一次出現的
function filterRecent(texts, now) {
  const fresh = []
  for (const text of texts) {
    const last = recentTexts.get(text) || 0
    if (now - last < DUPLICATE_WINDOW_MS) continue
    recentTexts.set(text, now)
    fresh.push(text)
  }
  if (recentTexts.size > 32) {
    // 順手清掉過期條目，避免 Map 無限長大
    for (const [text, at] of recentTexts) {
      if (now - at >= DUPLICATE_WINDOW_MS) recentTexts.delete(text)
    }
  }
  return fresh
}

function scheduleNextDecode(delay = DECODE_INTERVAL_MS) {
  clearTimeout(decodeTimer)
  decodeTimer = setTimeout(runDecodeTick, delay)
}

async function runDecodeTick() {
  if (state.value !== 'running' || stopRequested) return
  if (document.hidden) return // 分頁隱藏時暫停，恢復可見時由 visibilitychange 續跑
  const video = videoRef.value
  if (!video || video.readyState < 2 || decoding) {
    scheduleNextDecode()
    return
  }
  decoding = true
  let texts = []
  try {
    // 原生偵測器有結果但沒有左側 QR（常常只讀到一維條碼或右側 QR）時，
    // 同一張畫面還是要讓 zxing-wasm 試，不然左側 QR 永遠沒機會被解出來
    let hasLeftQr = false
    if (nativeDetector) {
      try {
        const codes = await nativeDetector.detect(video)
        if (codes.length) {
          texts = codes.map((c) => c.rawValue).filter(Boolean)
          hasLeftQr = texts.some((text) => parseEInvoiceCode(text).kind === 'left-qr')
        }
      } catch {
        nativeDetector = null // 原生偵測壞了，之後都走 zxing-wasm
      }
    }
    if (!hasLeftQr) {
      const frame = grabFrame(useCropNext)
      useCropNext = !useCropNext
      const zxingTexts = await decodeBarcodes(frame)
      // 兩邊可能都讀到同一個條碼，合併去重
      texts = [...new Set([...texts, ...zxingTexts])]
    }
  } finally {
    decoding = false
  }
  const fresh = filterRecent(texts, Date.now())
  if (fresh.length) emit('decoded', fresh)
  if (state.value === 'running' && !stopRequested) scheduleNextDecode()
}

function onVisibilityChange() {
  // scheduleNextDecode 會先清掉舊計時器，重複呼叫也只會有一個在排
  if (!document.hidden && state.value === 'running' && !stopRequested) scheduleNextDecode()
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
    const media = await openCamera()
    if (stopRequested) {
      // 啟動期間被要求停止（例如掃到結果或切換分頁），補停避免相機沒關
      releaseStream(media)
      return
    }
    stream = media
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        nativeDetector = new window.BarcodeDetector({ formats: ['qr_code', 'code_39'] })
      } catch {
        nativeDetector = null
      }
    }
    const video = videoRef.value
    video.srcObject = media
    await video.play()
    if (stopRequested) {
      await stop()
      return
    }
    setupTrackFeatures()
    if (!visibilityHandler) {
      visibilityHandler = onVisibilityChange
      document.addEventListener('visibilitychange', visibilityHandler)
    }
    recentTexts.clear()
    state.value = 'running'
    scheduleNextDecode(300) // 給自動曝光對焦一點時間再開始解
  } catch (err) {
    releaseStream(stream)
    stream = null
    state.value = 'error'
    errorMsg.value = friendlyError(err)
    emit('error', errorMsg.value)
  }
}

async function stop() {
  stopRequested = true
  clearTimeout(decodeTimer)
  decodeTimer = null
  releaseStream(stream)
  stream = null
  const video = videoRef.value
  if (video) video.srcObject = null
  torchAvailable.value = false
  torchOn.value = false
  if (state.value !== 'error') state.value = 'idle'
}

onBeforeUnmount(() => {
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler)
    visibilityHandler = null
  }
  stop()
})

// 讓父元件知道相機是否正在運作（顯示「拍下來辨識文字」按鈕用）
watch(state, (value) => emit('running', value === 'running'))

/**
 * 拍下目前畫面（原始解析度、不裁切）輸出 JPEG Blob；沒有畫面時回 null。
 * 之後由父元件停相機、送 OCR。
 */
async function captureFrame() {
  const video = videoRef.value
  const vw = video?.videoWidth || 0
  const vh = video?.videoHeight || 0
  if (!vw || !vh) return null
  const canvas = document.createElement('canvas')
  canvas.width = vw
  canvas.height = vh
  canvas.getContext('2d').drawImage(video, 0, 0)
  return await new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92)
  )
}

defineExpose({ start, stop, captureFrame })
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
        <video ref="videoRef" class="qr-view" playsinline muted autoplay></video>
        <span v-if="state !== 'running'" class="qr-idle" aria-hidden="true">
          <ScanLine :size="34" stroke-width="1.4" />
        </span>
        <template v-else>
          <button
            v-if="torchAvailable"
            type="button"
            class="qr-torch"
            :title="torchOn ? '關閉手電筒' : '開啟手電筒'"
            @click="toggleTorch"
          >
            <Flashlight v-if="!torchOn" :size="16" />
            <FlashlightOff v-else :size="16" />
          </button>
          <div class="qr-corners" aria-hidden="true">
            <div class="qr-box">
              <span class="corner tl"></span>
              <span class="corner tr"></span>
              <span class="corner bl"></span>
              <span class="corner br"></span>
            </div>
          </div>
        </template>
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

      <p class="qr-tip">先把發票攤平，整張放進框內、距離約 10–15 公分；會自動讀取左側 QR Code。</p>
    </template>
  </div>
</template>
