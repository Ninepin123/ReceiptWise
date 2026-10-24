// API client：fetch 包裝，自動帶 Bearer token，統一錯誤格式。
// token 直接讀 localStorage，避免和 auth store 循環 import。
import { STORAGE_KEYS } from '../constants'

/** 伺服器回傳的錯誤（4xx / 5xx），message 為後端給使用者看的中文說明。 */
export class ApiError extends Error {
  constructor(status, code, message, fields) {
    super(message || '發生錯誤，請稍後再試')
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
  }
}

/** fetch 本身失敗（斷線、伺服器沒開）。 */
export class NetworkError extends Error {
  constructor() {
    super('網路連線失敗，請檢查網路後再試')
    this.name = 'NetworkError'
  }
}

// 401 unauthorized 時清掉登入狀態並回到登入頁（invalid_credentials 不在此列）
function handleUnauthorized() {
  localStorage.removeItem(STORAGE_KEYS.token)
  localStorage.removeItem(STORAGE_KEYS.user)
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    window.location.assign('/login')
  }
}

/**
 * 送出 fetch 的共用部分：帶 token、解析 JSON、統一錯誤處理。
 * headers 由呼叫端給（JSON 要設 Content-Type，multipart 不能設）。
 */
async function send(path, { method = 'GET', headers, body } = {}) {
  const token = localStorage.getItem(STORAGE_KEYS.token)
  let res
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { ...(headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body
    })
  } catch {
    throw new NetworkError()
  }

  if (res.status === 204) return null

  let data = null
  try {
    data = await res.json()
  } catch {
    // 回應不是 JSON 就只帶狀態碼
  }

  if (!res.ok) {
    const code = data?.error ?? 'unknown_error'
    if (res.status === 401 && code === 'unauthorized') handleUnauthorized()
    throw new ApiError(res.status, code, data?.message, data?.fields)
  }
  return data
}

/**
 * 發送 API 請求。成功回傳解析後的 JSON（204 回 null）；
 * 伺服器錯誤丟 ApiError；連不上丟 NetworkError。
 */
export async function request(method, path, body) {
  return send(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
}

/**
 * 上傳 multipart/form-data（例如 OCR 圖片）。
 * 不設 Content-Type，讓瀏覽器自己帶 multipart boundary。
 */
export async function upload(path, formData) {
  return send(path, { method: 'POST', body: formData })
}

/** 方便的包裝：api.get(path) / api.post(path, body) / api.put / api.del / api.upload。 */
export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  del: (path) => request('DELETE', path),
  upload: (path, formData) => upload(path, formData)
}
