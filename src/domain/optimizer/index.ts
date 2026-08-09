/**
 * 排样引擎入口 —— 展开零件 → 模拟退火（固定种子）→ 统计回填 → 校验输出。
 */
import {
  EPSILON,
  type CutPlan,
  type OptimizeSettings,
  type Part,
  type Placement,
  type PlanStats,
  type PricingPrefs,
  type Quality,
  type SheetLayout,
  type SheetSpec,
} from '../types'
import { calcCost } from '../pricing'
import { iterationBudget, search, type SearchInstance } from './search'
import { evaluatePlan } from './evaluate'
import type { PackResult } from './stripPacker'
import { validatePlan } from './validator'
import { DEFAULT_QUALITY } from '../materials'

export interface OptimizeInput {
  parts: Part[]
  /** 板材库（多选组合，≥1；每张板排样时从中选规格） */
  sheets: SheetSpec[]
  settings: OptimizeSettings
  /** 价格核算配置（缺省 = 不核算，totalCost 记 0） */
  pricing?: PricingPrefs
}

export interface OptCtx {
  onProgress?: (p: number) => void
  signal?: AbortSignal
}

export interface Optimizer {
  optimize(input: OptimizeInput, ctx?: OptCtx): Promise<CutPlan>
}

export type OptimizeErrorCode = 'PART_TOO_LARGE' | 'SHEET_TOO_SMALL' | 'NO_PARTS' | 'NO_SHEETS' | 'CANCELLED'

export class OptimizeError extends Error {
  code: OptimizeErrorCode
  constructor(code: OptimizeErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

/** 可用区域（trim + margin 后） */
export function usableArea(sheet: SheetSpec, settings: OptimizeSettings): { w: number; h: number; area: number } {
  const border = settings.trimAllowance
  const w = sheet.length - 2 * border
  const h = sheet.width - 2 * border
  return { w, h, area: w * h }
}

function expandInstances(parts: Part[], settings: OptimizeSettings): SearchInstance[] {
  const out: SearchInstance[] = []
  for (const p of parts) {
    for (let i = 0; i < p.quantity; i++) {
      const rotatable = p.grain === 'any'
      const baseLen = p.length
      const baseWid = p.width
      out.push({
        partId: p.id,
        instance: i,
        slotLen: baseLen + settings.kerf,
        slotWid: baseWid + settings.kerf,
        len: baseLen,
        wid: baseWid,
        rotated: false,
        rotatable,
        baseSlotLen: baseLen + settings.kerf,
        baseSlotWid: baseWid + settings.kerf,
        baseLen,
        baseWid,
        sheetId: p.sheetId,
      })
    }
  }
  return out
}

function computeStats(
  sheets: SheetLayout[],
  result: PackResult,
  usableAreaBySpecId: Map<string, number>,
  priceBySpecId: Map<string, number>,
  sheetLibrary: SheetSpec[],
  minReusableWaste: number,
  settings: OptimizeSettings,
  pricing: PricingPrefs,
  edgeBands: Map<string, ('L' | 'R' | 'T' | 'B')[]>,
): PlanStats {
  let usedArea = 0
  for (const sheet of sheets) {
    for (const pl of sheet.placements) usedArea += pl.len * pl.wid
  }
  let totalUsable = 0
  for (const sheet of sheets) totalUsable += usableAreaBySpecId.get(sheet.sheetSpecId) ?? 0
  const wasteArea = Math.max(0, totalUsable - usedArea)
  const utilization = totalUsable > 0 ? (usedArea / totalUsable) * 100 : 0

  const score = evaluatePlan(result, minReusableWaste)

  // 成本核算（按 PricingPrefs：每样精算 / 按面积 / 关闭 → 回填 stats.totalCost）
  const plan: CutPlan = {
    id: '',
    createdAt: 0,
    sheets,
    sheetLibrary,
    stats: {
      sheetCount: sheets.length,
      utilization,
      totalCost: 0,
      wasteArea,
      reusableWasteBlocks: score.reusableWasteBlocks,
      largestReusableWaste: score.largestReusableWaste,
    },
    settings,
  }
  const cost = calcCost(plan, priceBySpecId, pricing, edgeBands)
  return {
    sheetCount: sheets.length,
    utilization,
    totalCost: cost.totalCost,
    wasteArea,
    reusableWasteBlocks: score.reusableWasteBlocks,
    largestReusableWaste: score.largestReusableWaste,
  }
}

/**
 * 排样引擎入口 —— settings 唯一来源是 OptimizeInput.settings
 * （createOptimizer 不再接收 settings，杜绝"双来源静默忽略"）。
 */
/** 解析计算质量：新数据直接取 quality；旧数据（timeLimitMs）兜底映射 */
function resolveQuality(settings: OptimizeSettings): Quality {
  if (settings.quality) return settings.quality
  const legacy = (settings as OptimizeSettings & { timeLimitMs?: number }).timeLimitMs
  if (legacy !== undefined) {
    if (legacy <= 3000) return 'fast'
    if (legacy <= 8000) return 'standard'
    return 'fine'
  }
  return DEFAULT_QUALITY
}

export function createOptimizer(): Optimizer {
  return {
    async optimize(input, ctx) {
      const { parts, sheets } = input
      const settings = input.settings
      const pricing = input.pricing ?? { enabled: false, mode: 'itemized', edgePricePerM: 0, processingFeePerSheet: 0, areaPricePerSqm: 0 }
      if (sheets.length === 0) throw new OptimizeError('NO_SHEETS', '板材库为空')
      const validParts = parts.filter((p) => p.quantity > 0 && p.length > 0 && p.width > 0)
      if (validParts.length === 0) throw new OptimizeError('NO_PARTS', '零件清单为空')

      // 板材库 → 可用区条目 + 面积/价格索引
      const library: { id: string; usableW: number; usableH: number }[] = []
      const usableAreaBySpecId = new Map<string, number>()
      const priceBySpecId = new Map<string, number>()
      for (const s of sheets) {
        const usable = usableArea(s, settings)
        if (usable.w <= EPSILON || usable.h <= EPSILON) {
          throw new OptimizeError('SHEET_TOO_SMALL', `板材 ${s.name} 修边/留边后可用区域过小`)
        }
        library.push({ id: s.id, usableW: usable.w, usableH: usable.h })
        usableAreaBySpecId.set(s.id, usable.area)
        priceBySpecId.set(s.id, s.price)
      }

      const instances = expandInstances(validParts, settings)
      // 预检：每个零件至少能被一种规格装下（指定 sheetId 的必须能被该规格装下）
      for (const inst of instances) {
        const fit = library.some((l) => {
          if (inst.sheetId && l.id !== inst.sheetId) return false
          const slotW = l.usableW + settings.kerf
          const slotH = l.usableH + settings.kerf
          return inst.slotLen <= slotW + EPSILON && inst.slotWid <= slotH + EPSILON
        })
        if (!fit) {
          throw new OptimizeError('PART_TOO_LARGE', `零件 ${inst.partId} 大于板材库中可用规格`)
        }
      }

      if (ctx?.signal?.aborted) throw new DOMException('cancelled', 'AbortError')

      const iterations = iterationBudget(resolveQuality(settings), instances.length)
      const outcome = search({
        instances,
        library,
        kerf: settings.kerf,
        minReusableWaste: settings.minReusableWaste,
        iterations,
        seed: settings.seed,
        onProgress: ctx?.onProgress,
        signal: ctx?.signal,
      })

      // 组装 CutPlan
      const sheetLayouts: SheetLayout[] = outcome.result.sheets.map((ps, idx) => ({
        sheetIndex: idx,
        sheetSpecId: ps.sheetSpecId,
        placements: ps.placements.map<Placement>(({ item, x, y }) => ({
          partId: item.partId,
          instance: item.instance,
          x,
          y,
          len: item.len,
          wid: item.wid,
          rotated: item.rotated,
        })),
      }))
      const plan: CutPlan = {
        id: '',
        createdAt: 0,
        sheets: sheetLayouts,
        sheetLibrary: sheets,
        stats: computeStats(
          sheetLayouts,
          outcome.result,
          usableAreaBySpecId,
          priceBySpecId,
          sheets,
          settings.minReusableWaste,
          settings,
          pricing,
          new Map(validParts.map((p) => [p.id, p.edgeBand ?? []])),
        ),
        settings,
      }

      // 输出前强制校验（任何方案必须过校验）
      const v = validatePlan(plan, validParts, sheets, settings)
      if (!v.ok) {
        throw new Error(`优化结果未通过校验：${v.errors.slice(0, 3).join('；')}`)
      }
      return plan
    },
  }
}
