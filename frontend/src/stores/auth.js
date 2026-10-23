// 登入狀態：token / user 存 localStorage，重新整理後仍保持登入。
import { defineStore } from 'pinia'
import { api } from '../api/client'
import { STORAGE_KEYS } from '../constants'

// 讀取存的 user JSON（壞掉就當作沒登入過）
function readStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.user) || 'null')
  } catch {
    return null
  }
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem(STORAGE_KEYS.token) || '',
    user: readStoredUser()
  }),
  getters: {
    isLoggedIn: (state) => Boolean(state.token)
  },
  actions: {
    // 把 token / user 寫回（或清掉）localStorage
    persist() {
      if (this.token) localStorage.setItem(STORAGE_KEYS.token, this.token)
      else localStorage.removeItem(STORAGE_KEYS.token)
      if (this.user) localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(this.user))
      else localStorage.removeItem(STORAGE_KEYS.user)
    },
    applySession(res) {
      this.token = res.token
      this.user = res.user
      this.persist()
    },
    async login(email, password) {
      this.applySession(await api.post('/auth/login', { email, password }))
    },
    async register(email, password, displayName) {
      this.applySession(await api.post('/auth/register', { email, password, displayName }))
    },
    async fetchMe() {
      if (!this.token) return
      const res = await api.get('/auth/me')
      this.user = res.user
      this.persist()
    },
    logout() {
      this.token = ''
      this.user = null
      this.persist()
    }
  }
})
