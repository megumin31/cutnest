/**
 * 服务端 API 客户端 —— Cloudflare Workers（架构文档 §8.3）。
 * 错误码协议：401 UNAUTHORIZED / 402 INSUFFICIENT_CREDITS / 422 RECOGNITION_FAILED / 网络错误。
 */
import type { DeviceInfo, RecognizedSheet } from '../../domain/types'

export class ApiError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export interface AuthResult {
  email: string
  paid: boolean
  credits: number
  deviceFp: string
  token: string
}

export interface PurchaseResult {
  paid: boolean
  credits: number
}

export interface ApiClient {
  register(email: string, password: string): Promise<AuthResult>
  login(email: string, password: string): Promise<AuthResult>
  /** Web：OAuth 重定向流程；桌面：系统浏览器 + 本地回调端口 */
  googleLogin(): Promise<AuthResult>
  /** OAuth 回调后，用一次性 code 换正式凭证（带本机设备指纹） */
  exchangeOauthCode(code: string, deviceFp: string): Promise<AuthResult>
  logout(): Promise<void>
  /** 心跳/登录态刷新：在设备列表则续用；被踢则抛 401 */
  refreshSession(token: string, deviceFp: string): Promise<AuthResult>
  recognize(token: string, deviceFp: string, image: Blob, imageHash: string): Promise<RecognizedSheet>
  buy(token: string, planId: string): Promise<PurchaseResult>
  listDevices(token: string): Promise<DeviceInfo[]>
  revokeDevice(token: string, fp: string): Promise<void>
}

/** API 模式：mock = 本地演示数据（开发）；remote = 真实 Cloudflare Workers */
export type ApiMode = 'mock' | 'remote'

export function resolveApiMode(): ApiMode {
  const mode = import.meta.env.VITE_API_MODE as ApiMode | undefined
  if (mode === 'remote') return 'remote'
  if (mode === 'mock') return 'mock'
  return import.meta.env.DEV ? 'mock' : 'remote'
}

export const apiMode: ApiMode = resolveApiMode()

export function getApiClient(): ApiClient {
  if (apiMode === 'mock') {
    return new MockApiClient()
  }
  return new RemoteApiClient()
}

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

class RemoteApiClient implements ApiClient {
  private async request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
    let resp: Response
    // FormData 禁止手动设 Content-Type：浏览器需要自己附加 multipart boundary，否则服务端解析失败
    const headers = new Headers(init.headers)
    if (token) headers.set('Authorization', `Bearer ${token}`)
    if (!(init.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json')
    }
    try {
      resp = await fetch(`${BASE_URL}${path}`, {
        ...init,
        headers,
      })
    } catch {
      throw new ApiError('NETWORK', '网络异常，请联网后重试')
    }
    const body = (await resp.json().catch(() => null)) as { ok?: boolean; data?: T; code?: string; message?: string } | null
    if (!resp.ok || !body?.ok) {
      throw new ApiError(body?.code ?? 'UNKNOWN', body?.message ?? `请求失败 (${resp.status})`)
    }
    return body.data as T
  }

  register(email: string, password: string) {
    return this.request<AuthResult>('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) })
  }
  login(email: string, password: string) {
    return this.request<AuthResult>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
  }
  async googleLogin(): Promise<AuthResult> {
    // OAuth 重定向流程：跳转授权页，服务端完成 Google 流程后携带 ?oauthCode= 重定向回当前地址
    const returnTo = encodeURIComponent(window.location.origin + window.location.pathname)
    window.location.href = `${BASE_URL}/api/oauth/google?returnTo=${returnTo}`
    // TS5.6 lib 无 ES2024.Promise，运行时 Node18+/现代浏览器均已支持
    const wr = Promise as unknown as {
      withResolvers<T>(): {
        promise: Promise<T>
        resolve: (value: T | PromiseLike<T>) => void
        reject: (reason?: unknown) => void
      }
    }
    const { promise } = wr.withResolvers<AuthResult>() // 不返回：页面被重定向，登录态由 completeOAuth 恢复
    return promise
  }
  exchangeOauthCode(code: string, deviceFp: string) {
    return this.request<AuthResult>('/api/oauth/exchange', { method: 'POST', body: JSON.stringify({ code, deviceFp }) })
  }
  logout() {
    return this.request<void>('/api/auth/logout', { method: 'POST' })
  }
  refreshSession(token: string, deviceFp: string) {
    return this.request<AuthResult>('/api/session/refresh', { method: 'POST', body: JSON.stringify({ deviceFp }) }, token)
  }
  recognize(token: string, deviceFp: string, image: Blob, imageHash: string) {
    const form = new FormData()
    form.append('image', image)
    form.append('deviceFp', deviceFp)
    form.append('imageHash', imageHash)
    return this.request<RecognizedSheet>('/api/recognize', { method: 'POST', body: form }, token)
  }
  buy(token: string, planId: string) {
    return this.request<PurchaseResult>('/api/buy', { method: 'POST', body: JSON.stringify({ planId }) }, token)
  }
  listDevices(token: string) {
    return this.request<DeviceInfo[]>('/api/session/devices', { method: 'GET' }, token)
  }
  revokeDevice(token: string, fp: string) {
    return this.request<void>('/api/session/devices/revoke', { method: 'POST', body: JSON.stringify({ fp }) }, token)
  }
}

/**
 * Mock 客户端 —— 仅开发/演示模式：localStorage 模拟账号、额度、设备（滚动淘汰）。
 * 生产构建（VITE_API_MODE=remote）不会加载本实现。
 */
class MockApiClient implements ApiClient {
  private static hash(s: string): string {
    let h = 5381
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
    return `h${h >>> 0}`
  }

  private read(): Record<string, unknown> {
    try {
      return JSON.parse(localStorage.getItem('cut3-mock-db') ?? '{}') as Record<string, unknown>
    } catch {
      return {}
    }
  }

  private write(db: Record<string, unknown>) {
    localStorage.setItem('cut3-mock-db', JSON.stringify(db))
  }

  private session(): { email: string; token: string; deviceFp: string } | null {
    const db = this.read()
    const s = db.session as { email: string; token: string; deviceFp: string } | undefined
    return s ?? null
  }

  private account(email: string): { email: string; passwordHash: string; paid: boolean; credits: number; createdAt: number } | undefined {
    const db = this.read()
    const accounts = (db.accounts ?? []) as { email: string; passwordHash: string; paid: boolean; credits: number; createdAt: number }[]
    return accounts.find((a) => a.email === email)
  }

  private loginInternal(email: string): AuthResult {
    const db = this.read()
    const accounts = (db.accounts ?? []) as { email: string; passwordHash: string; paid: boolean; credits: number }[]
    const account = accounts.find((a) => a.email === email)
    if (!account) throw new ApiError('401', '账号不存在')
    const fp = localStorage.getItem('cut3-device-fp') ?? `web-${crypto.randomUUID()}`
    localStorage.setItem('cut3-device-fp', fp)
    // 设备滚动淘汰（最多 3 台）
    const devices = (db.devices ?? []) as { fp: string; lastSeenAt: number }[]
    const filtered = devices.filter((d) => d.fp !== fp)
    filtered.push({ fp, lastSeenAt: Date.now() })
    const kept = filtered.sort((a, b) => b.lastSeenAt - a.lastSeenAt).slice(0, 3)
    db.devices = kept
    const token = `mock-${MockApiClient.hash(email + Date.now())}`
    db.session = { email, token, deviceFp: fp }
    this.write(db)
    return { email, paid: account.paid, credits: account.credits, deviceFp: fp, token }
  }

  async register(email: string, password: string): Promise<AuthResult> {
    const db = this.read()
    const accounts = (db.accounts ?? []) as { email: string; passwordHash: string; paid: boolean; credits: number; createdAt: number }[]
    if (accounts.some((a) => a.email === email)) throw new ApiError('409', '该邮箱已注册')
    // 新账号附赠 10 次识别额度（演示）
    accounts.push({ email, passwordHash: MockApiClient.hash(password), paid: false, credits: 10, createdAt: Date.now() })
    db.accounts = accounts
    this.write(db)
    return this.loginInternal(email)
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const account = this.account(email)
    if (!account) throw new ApiError('401', '邮箱或密码不正确')
    if (account.passwordHash !== MockApiClient.hash(password)) throw new ApiError('401', '邮箱或密码不正确')
    return this.loginInternal(email)
  }

  async googleLogin(): Promise<AuthResult> {
    const email = 'demo@gmail.com'
    const db = this.read()
    const accounts = (db.accounts ?? []) as { email: string; passwordHash: string; paid: boolean; credits: number; createdAt: number }[]
    if (!accounts.some((a) => a.email === email)) {
      accounts.push({ email, passwordHash: '', paid: false, credits: 10, createdAt: Date.now() })
      db.accounts = accounts
      this.write(db)
    }
    return this.loginInternal(email)
  }

  async exchangeOauthCode(_code: string, _deviceFp: string): Promise<AuthResult> {
    // mock 模式不走重定向，直接等价 Google 登录演示账号
    return this.googleLogin()
  }

  async logout(): Promise<void> {
    const db = this.read()
    delete db.session
    this.write(db)
  }

  async refreshSession(token: string, deviceFp: string): Promise<AuthResult> {
    const s = this.session()
    if (!s || s.token !== token) throw new ApiError('401', '登录已失效，请重新登录')
    const account = this.account(s.email)
    if (!account) throw new ApiError('401', '登录已失效，请重新登录')
    return { email: s.email, paid: account.paid, credits: account.credits, deviceFp, token }
  }

  async recognize(token: string, _deviceFp: string, _image: Blob, _imageHash: string): Promise<RecognizedSheet> {
    const s = this.session()
    if (!s || s.token !== token) throw new ApiError('401', '登录已失效，请重新登录')
    const db = this.read()
    const accounts = (db.accounts ?? []) as { email: string; passwordHash: string; paid: boolean; credits: number }[]
    const account = accounts.find((a) => a.email === s.email)
    if (!account) throw new ApiError('401', '登录已失效，请重新登录')
    if (account.credits < 1) throw new ApiError('402', '识别次数不足，请先购买')
    // 成功才扣次
    account.credits -= 1
    this.write(db)
    // 演示数据：含一个低置信度行，供审查表展示"待确认"状态
    return {
      items: [
        { name: '侧板', length: 2440, width: 400, quantity: 4, confidence: 0.92 },
        { name: '抽屉面板', length: 1200, width: 400, quantity: 8, confidence: 0.87 },
        { name: '层板', length: 800, width: 400, quantity: 6, confidence: 0.95 },
        { name: '横档', length: 400, width: 300, quantity: 12, confidence: 0.58 },
      ],
      rawText: '侧板 2440×400 ×4\n抽屉面板 1200×400 ×8\n层板 800×400 ×6\n横档 400×300 ×12',
    }
  }

  async buy(token: string, _planId: string): Promise<PurchaseResult> {
    const s = this.session()
    if (!s || s.token !== token) throw new ApiError('401', '登录已失效，请重新登录')
    const db = this.read()
    const accounts = (db.accounts ?? []) as { email: string; passwordHash: string; paid: boolean; credits: number }[]
    const account = accounts.find((a) => a.email === s.email)
    if (!account) throw new ApiError('401', '登录已失效，请重新登录')
    account.paid = true
    this.write(db)
    return { paid: true, credits: account.credits }
  }

  async listDevices(token: string): Promise<DeviceInfo[]> {
    const s = this.session()
    if (!s || s.token !== token) throw new ApiError('401', '登录已失效，请重新登录')
    const db = this.read()
    const devices = (db.devices ?? []) as { fp: string; lastSeenAt: number }[]
    return devices.map((d) => ({ fp: d.fp, lastSeenAt: d.lastSeenAt, current: d.fp === s.deviceFp }))
  }

  async revokeDevice(token: string, fp: string): Promise<void> {
    const s = this.session()
    if (!s || s.token !== token) throw new ApiError('401', '登录已失效，请重新登录')
    const db = this.read()
    const devices = (db.devices ?? []) as { fp: string; lastSeenAt: number }[]
    db.devices = devices.filter((d) => d.fp !== fp)
    this.write(db)
  }
}
