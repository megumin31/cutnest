/**
 * 设置 store —— 会话态 + 持久化（storage.settings）。
 */
import { create } from 'zustand'
import { storage } from '../../infra/storage'
import type { LengthUnit } from '../../domain/units'
import type { PricingPrefs } from '../../domain/types'
import { DEFAULT_PRICING } from '../../domain/pricing'

export type ThemePref = 'light' | 'dark' | 'system'

export interface AppSettings {
  unit: LengthUnit
  uiLang: string
  exportLang: string
  theme: ThemePref
  /** 新建项目默认板材库（板材规格 id 列表） */
  defaultSheetIds?: string[]
  /** 新建项目默认切缝 */
  kerf?: number
  /** 新建项目默认修边 */
  trim?: number
  /** 价格核算配置（可整体关闭） */
  pricing: PricingPrefs
}

export const DEFAULT_SETTINGS: AppSettings = {
  unit: 'mm',
  uiLang: 'zh',
  exportLang: 'zh',
  theme: 'light',
  pricing: DEFAULT_PRICING,
}

interface SettingsState {
  settings: AppSettings
  loaded: boolean
  load: () => Promise<void>
  update: (patch: Partial<AppSettings>) => Promise<void>
  updatePricing: (patch: Partial<PricingPrefs>) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  async load() {
    const stored = await storage.getSetting<AppSettings>('app-settings')
    set({
      settings: {
        ...DEFAULT_SETTINGS,
        ...stored,
        pricing: { ...DEFAULT_PRICING, ...(stored?.pricing ?? {}) },
      },
      loaded: true,
    })
  },
  async update(patch) {
    const next = { ...get().settings, ...patch }
    set({ settings: next })
    await storage.setSetting('app-settings', next)
  },
  async updatePricing(patch) {
    const next = { ...get().settings, pricing: { ...get().settings.pricing, ...patch } }
    set({ settings: next })
    await storage.setSetting('app-settings', next)
  },
}))

/** 实际生效的主题模式（system → 跟随系统） */
export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'system') {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return pref
}
