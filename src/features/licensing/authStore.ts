/**
 * 授权 store —— 登录状态/额度/设备（会话态；权威数据在服务端）。
 * 状态机：loggedOut → loggingIn → loggedIn → loggedOut（被设备淘汰时强制退出）。
 */
import { create } from 'zustand'
import { getApiClient, ApiError } from '../../infra/api'
import type { AuthStatus, DeviceInfo } from '../../domain/types'
import { storage } from '../../infra/storage'
import { platform } from '../../infra/platform'

const api = getApiClient()

interface AuthState {
  status: AuthStatus
  devices: DeviceInfo[]
  error: string | null
  load: () => Promise<void>
  /** OAuth 回调恢复：URL 带 ?oauthCode= 时换取正式凭证（启动时调用） */
  completeOAuth: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  googleLogin: () => Promise<void>
  logout: () => Promise<void>
  buyLicense: () => Promise<void>
  listDevices: () => Promise<void>
  revokeDevice: (fp: string) => Promise<void>
  /** 主动刷新会话（识别扣次后刷新余额） */
  refresh: () => Promise<void>
}

/** 体验版零件上限 */
export const TRIAL_PART_LIMIT = 20

export const useAuthStore = create<AuthState>((set, get) => ({
  status: { state: 'loggedOut' },
  devices: [],
  error: null,

  async load() {
    const saved = (await storage.getAuth()) as AuthStatus | undefined
    if (saved?.state === 'loggedIn') {
      set({ status: saved })
      // 尝试联网刷新（失败静默：离线可用，180 天凭证）
      try {
        const fresh = await api.refreshSession(saved.token, platform.getDeviceFingerprint())
        const next: AuthStatus = {
          state: 'loggedIn',
          email: fresh.email,
          token: fresh.token,
          paid: fresh.paid,
          credits: fresh.credits,
          deviceFp: fresh.deviceFp,
        }
        set({ status: next })
        await storage.setAuth(next)
      } catch (e) {
        if (e instanceof ApiError && e.code === '401') {
          // 被设备淘汰 → 强制退出
          set({ status: { state: 'loggedOut' } })
          await storage.setAuth(null)
        }
      }
    }
  },

  async completeOAuth() {
    const code = new URLSearchParams(window.location.search).get('oauthCode')
    if (!code) return
    try {
      const r = await api.exchangeOauthCode(code, platform.getDeviceFingerprint())
      const status: AuthStatus = {
        state: 'loggedIn',
        email: r.email,
        token: r.token,
        paid: r.paid,
        credits: r.credits,
        deviceFp: r.deviceFp,
      }
      set({ status })
      await storage.setAuth(status)
    } catch (e) {
      set({ error: e instanceof ApiError ? e.message : 'Google 登录失败' })
    } finally {
      // 清除一次性 code，避免刷新页面重复兑换
      window.history.replaceState({}, '', window.location.pathname)
    }
  },

  async login(email, password) {
    set({ error: null })
    try {
      const r = await api.login(email, password)
      const status: AuthStatus = {
        state: 'loggedIn',
        email: r.email,
        token: r.token,
        paid: r.paid,
        credits: r.credits,
        deviceFp: r.deviceFp,
      }
      set({ status })
      await storage.setAuth(status)
    } catch (e) {
      set({ error: e instanceof ApiError ? e.message : '登录失败' })
      throw e
    }
  },

  async register(email, password) {
    set({ error: null })
    try {
      const r = await api.register(email, password)
      const status: AuthStatus = {
        state: 'loggedIn',
        email: r.email,
        token: r.token,
        paid: r.paid,
        credits: r.credits,
        deviceFp: r.deviceFp,
      }
      set({ status })
      await storage.setAuth(status)
    } catch (e) {
      set({ error: e instanceof ApiError ? e.message : '注册失败' })
      throw e
    }
  },

  async googleLogin() {
    set({ error: null })
    try {
      const r = await api.googleLogin()
      const status: AuthStatus = {
        state: 'loggedIn',
        email: r.email,
        token: r.token,
        paid: r.paid,
        credits: r.credits,
        deviceFp: r.deviceFp,
      }
      set({ status })
      await storage.setAuth(status)
    } catch (e) {
      set({ error: e instanceof ApiError ? e.message : 'Google 登录失败' })
      throw e
    }
  },

  async logout() {
    try {
      await api.logout()
    } catch {
      // 忽略网络错误，本地一律清除
    }
    set({ status: { state: 'loggedOut' }, devices: [] })
    await storage.setAuth(null)
  },

  async buyLicense() {
    const s = get().status
    if (s.state !== 'loggedIn') return
    try {
      const r = await api.buy(s.token, 'license')
      const next: AuthStatus = { ...s, paid: r.paid, credits: r.credits }
      set({ status: next })
      await storage.setAuth(next)
    } catch (e) {
      set({ error: e instanceof ApiError ? e.message : '购买失败' })
    }
  },

  async listDevices() {
    const s = get().status
    if (s.state !== 'loggedIn') return
    try {
      const devices = await api.listDevices(s.token)
      set({ devices })
    } catch (e) {
      if (e instanceof ApiError && e.code === '401') {
        set({ status: { state: 'loggedOut' }, devices: [] })
        await storage.setAuth(null)
      }
    }
  },

  async revokeDevice(fp) {
    const s = get().status
    if (s.state !== 'loggedIn') return
    try {
      await api.revokeDevice(s.token, fp)
      await get().listDevices()
    } catch (e) {
      set({ error: e instanceof ApiError ? e.message : '操作失败' })
    }
  },

  async refresh() {
    const s = get().status
    if (s.state !== 'loggedIn') return
    try {
      const fresh = await api.refreshSession(s.token, s.deviceFp)
      const next: AuthStatus = { state: 'loggedIn', email: fresh.email, token: fresh.token, paid: fresh.paid, credits: fresh.credits, deviceFp: fresh.deviceFp }
      set({ status: next })
      await storage.setAuth(next)
    } catch (e) {
      if (e instanceof ApiError && e.code === '401') {
        set({ status: { state: 'loggedOut' } })
        await storage.setAuth(null)
      }
    }
  },
}))
