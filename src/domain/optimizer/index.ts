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
import { calcCost, edgeLengthOf } from '../pricing'
import { iterationBudget, search, type SearchInstance } from './search'
import { evaluatePlan } from './evaluate'
import type { PackResult, SheetLibraryEntry } from './stripPacker'
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

/** 可用区域（trim 修边后）。len/wid = 长边（X 轴）/宽边（Y 轴）方向尺寸 */
export function usableArea(sheet: SheetSpec, settings: OptimizeSettings): { len: number; wid: number; area: number } {
  const trim = settings.trimAllowance
  const len = sheet.length - 2 * trim
  const wid = sheet.width - 2 * trim
  return { len, wid, area: len * wid }
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
  let edgeMeters = 0
  for (const sheet of sheets) {
    for (const pl of sheet.placements) {
      usedArea += pl.len * pl.wid
      edgeMeters += edgeLengthOf(pl.len, pl.wid, edgeBands.get(pl.partId)) / 1000
    }
  }
  let totalUsable = 0
  for (const sheet of sheets) totalUsable += usableAreaBySpecId.get(sheet.sheetSpecId) ?? 0
  const wasteArea = Math.max(0, totalUsable - usedArea)
  const utilization = totalUsable > 0 ? (usedArea / totalUsable) * 100 : 0

  const score = evaluatePlan(result, minReusableWaste)

  // 成本核算：无论 pricing.enabled 与否都计算两种计价模式（开关只影响 UI 展示）。
  // totalCost 保持"计算时 mode 对应的值"（快照语义，历史方案与 PDF 导出沿用）
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
  const costOf = (mode: 'itemized' | 'byArea'): number =>
    calcCost(plan, priceBySpecId, { ...pricing, enabled: true, mode }, edgeBands).totalCost
  const costItemized = costOf('itemized')
  const costByArea = costOf('byArea')
  return {
    sheetCount: sheets.length,
    utilization,
    totalCost: pricing.mode === 'byArea' ? costByArea : costItemized,
    wasteArea,
    reusableWasteBlocks: score.reusableWasteBlocks,
    largestReusableWaste: score.largestReusableWaste,
    edgeMeters,
    partArea: usedArea,
    costItemized,
    costByArea,
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
      const library: SheetLibraryEntry[] = []
      const usableAreaBySpecId = new Map<string, number>()
      const priceBySpecId = new Map<string, number>()
      for (const s of sheets) {
        const usable = usableArea(s, settings)
        if (usable.len <= EPSILON || usable.wid <= EPSILON) {
          throw new OptimizeError('SHEET_TOO_SMALL', `板材 ${s.name} 修边后可用区域过小`)
        }
        library.push({ id: s.id, usableLen: usable.len, usableWid: usable.wid })
        usableAreaBySpecId.set(s.id, usable.area)
        priceBySpecId.set(s.id, s.price)
      }

      const instances = expandInstances(validParts, settings)
      // 预检：每个零件至少能被一种规格装下（指定 sheetId 的必须能被该规格装下）
      for (const inst of instances) {
        const fit = library.some((l) => {
          if (inst.sheetId && l.id !== inst.sheetId) return false
          return (
            inst.slotLen <= l.usableLen + settings.kerf + EPSILON &&
            inst.slotWid <= l.usableWid + settings.kerf + EPSILON
          )
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
