/**
 * platform 适配器 —— Web / Tauri 差异全部收敛在这里（架构文档 §8.4），
 * 业务代码禁止平台分支。
 */
export interface Platform {
  isDesktop(): boolean
  /** 保存文件：Web=浏览器下载，Tauri=原生保存对话框 */
  saveFile(bytes: Uint8Array, filename: string, mime: string): Promise<void>
  /** 打印：Web=window.print，Tauri=原生打印 */
  print(): void
  /** 设备指纹（Web：localStorage UUID；桌面：硬件序列号组合，由 Tauri 端提供） */
  getDeviceFingerprint(): string
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
    __cut3Native__?: {
      saveFile(bytes: Uint8Array, filename: string): Promise<void>
      print(): void
      deviceFingerprint(): string
    }
  }
}

const FP_KEY = 'cut3-device-fp'

export const platform: Platform = {
  isDesktop() {
    return typeof window !== 'undefined' && (!!window.__TAURI_INTERNALS__ || !!window.__cut3Native__)
  },

  async saveFile(bytes, filename, mime) {
    if (window.__cut3Native__) {
      await window.__cut3Native__.saveFile(bytes, filename)
      return
    }
    const blob = new Blob([bytes], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  },

  print() {
    if (window.__cut3Native__) {
      window.__cut3Native__.print()
      return
    }
    window.print()
  },

  getDeviceFingerprint() {
    if (window.__cut3Native__) {
      return window.__cut3Native__.deviceFingerprint()
    }
    let fp = localStorage.getItem(FP_KEY)
    if (!fp) {
      fp = `web-${crypto.randomUUID()}`
      localStorage.setItem(FP_KEY, fp)
    }
    return fp
  },
}
