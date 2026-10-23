import { defineStore } from 'pinia'

export const useAuthStore = defineStore('auth', {
  state: () => ({ user: localStorage.getItem('cloudledger-demo-user') || '' }),
  getters: { isLoggedIn: (state) => Boolean(state.user) },
  actions: {
    login(username) {
      this.user = username.trim()
      localStorage.setItem('cloudledger-demo-user', this.user)
    },
    logout() {
      this.user = ''
      localStorage.removeItem('cloudledger-demo-user')
    }
  }
})
