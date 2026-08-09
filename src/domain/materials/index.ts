/**
 * 板材规格库 —— 内置常用规格 + 工艺默认值。
 */
import type { OptimizeSettings, Quality, SheetSpec } from '../types'

export const DEFAULT_KERF = 3
export const DEFAULT_TRIM_ALLOWANCE = 0
export const DEFAULT_MIN_REUSABLE_WASTE = 200
export const DEFAULT_QUALITY: Quality = 'standard'
/** 每零件迭代预算（搜索强度锚定）：零件多寡时强度一致，总耗时随零件数自然增长 */
export const QUALITY_PART_ITER: Record<Quality, number> = { fast: 1.2, standard: 2.4, fine: 7 }
export const DEFAULT_SEED = 20260805

export const DEFAULT_SHEETS: SheetSpec[] = [
  { id: 'sheet-2440x1220', name: '颗粒板', length: 2440, width: 1220, price: 98 },
  { id: 'sheet-2440x1220-oak', name: '橡木多层板', length: 2440, width: 1220, price: 158 },
  { id: 'sheet-2400x1200', name: '多层板', length: 2400, width: 1200, price: 108 },
  { id: 'sheet-2000x1000', name: '生态板', length: 2000, width: 1000, price: 72 },
]

export function createDefaultSettings(overrides?: Partial<OptimizeSettings>): OptimizeSettings {
  return {
    kerf: DEFAULT_KERF,
    trimAllowance: DEFAULT_TRIM_ALLOWANCE,
    quality: DEFAULT_QUALITY,
    minReusableWaste: DEFAULT_MIN_REUSABLE_WASTE,
    seed: DEFAULT_SEED,
    ...overrides,
  }
}
