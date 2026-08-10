/**
 * 成本核算 —— 纯函数。排样完成后由 optimizer 调用回填 stats.totalCost，
 * 界面展示用（板材数/利用率/余料/总成本/每零件分摊）。
 *
 * 两种计价模式（设置页全局配置 PricingPrefs，可整体关闭）：
 * - itemized 每样精算：板材费（Σ 每张实际规格单价）+ 封边费（Σ 封边长度×单价，按米）+ 加工费（板数×单张加工费）
 * - byArea 按面积计价：零件实际总面积 × 面积单价
 * 每零件分摊一律按面积占比。
 */
import type { CostBreakdown, CutPlan, PlanStats, PricingPrefs } from '../types'

export const DEFAULT_PRICING: PricingPrefs = {
  enabled: true,
  mode: 'itemized',
  edgePricePerM: 3,
  processingFeePerSheet: 20,
  areaPricePerSqm: 120,
}

/**
 * 按当前计价模式取方案成本：
 * 新方案（含双模式快照 costItemized/costByArea）取对应模式值；
 * 旧历史方案（无快照）回退 totalCost（旧数据在关闭核算时算的为 0，无法回算）。
 */
export function planCost(stats: PlanStats, prefs: PricingPrefs): number {
  if (prefs.mode === 'itemized') return stats.costItemized ?? stats.totalCost
  return stats.costByArea ?? stats.totalCost
}

/** 零件封边长度（mm）：edgeBand 相对零件本体 —— L/R 是左右短边（宽向）、T/B 是上下长边（长向），旋转不影响 */
export function edgeLengthOf(len: number, wid: number, bands: ('L' | 'R' | 'T' | 'B')[] | undefined): number {
  if (!bands || bands.length === 0) return 0
  let l = 0
  for (const b of bands) {
    l += b === 'L' || b === 'R' ? wid : len
  }
  return l
}

export function calcCost(
  plan: CutPlan,
  priceBySpecId: Map<string, number>,
  prefs: PricingPrefs,
  edgeBands?: Map<string, ('L' | 'R' | 'T' | 'B')[]>,
): CostBreakdown {
  const sheetCount = plan.sheets.length
  let usedArea = 0
  let sheetCost = 0
  let edgeCost = 0
  let processingCost = 0
  let totalCost = 0
  const perPartArea: Record<string, number> = {}

  if (prefs.enabled) {
    if (prefs.mode === 'itemized') {
      for (const sheet of plan.sheets) {
        const price = priceBySpecId.get(sheet.sheetSpecId) ?? 0
        sheetCost += price
        for (const pl of sheet.placements) {
          const a = pl.len * pl.wid
          usedArea += a
          perPartArea[pl.partId] = (perPartArea[pl.partId] ?? 0) + a
          const el = edgeLengthOf(pl.len, pl.wid, edgeBands?.get(pl.partId))
          if (el > 0) edgeCost += (el / 1000) * prefs.edgePricePerM
        }
      }
      processingCost = sheetCount * prefs.processingFeePerSheet
      totalCost = sheetCost + edgeCost + processingCost
    } else {
      // byArea：零件总面积（mm²）→ m² × 面积单价
      for (const sheet of plan.sheets) {
        for (const pl of sheet.placements) {
          const a = pl.len * pl.wid
          usedArea += a
          perPartArea[pl.partId] = (perPartArea[pl.partId] ?? 0) + a
        }
      }
      totalCost = (usedArea / 1e6) * prefs.areaPricePerSqm
    }
  } else {
    for (const sheet of plan.sheets) {
      for (const pl of sheet.placements) {
        usedArea += pl.len * pl.wid
        perPartArea[pl.partId] = (perPartArea[pl.partId] ?? 0) + pl.len * pl.wid
      }
    }
  }

  const perPartCost: Record<string, number> = {}
  for (const [partId, area] of Object.entries(perPartArea)) {
    perPartCost[partId] = usedArea > 0 && totalCost > 0 ? (area / usedArea) * totalCost : 0
  }
  return {
    sheetCount,
    utilization: plan.stats.utilization,
    wasteArea: plan.stats.wasteArea,
    totalCost,
    sheetCost,
    edgeCost,
    processingCost,
    perPartCost,
  }
}
