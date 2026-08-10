/**
 * pricing 单测 —— 两种计价模式（每样精算 / 按面积）+ 关闭开关（架构文档 §6.4）。
 */
import { describe, it, expect } from 'vitest'
import { calcCost, planCost, DEFAULT_PRICING } from '../src/domain/pricing'
import type { CutPlan, Placement, PlanStats, PricingPrefs, SheetSpec } from '../src/domain/types'
import { createDefaultSettings } from '../src/domain/materials'

const settings = createDefaultSettings()
const sheetA: SheetSpec = { id: 's1', name: '颗粒板', length: 2440, width: 1220, price: 100 }
const sheetB: SheetSpec = { id: 's2', name: '多层板', length: 2400, width: 1200, price: 92 }
const price = new Map<string, number>([
  ['s1', sheetA.price],
  ['s2', sheetB.price],
])
const edgeBands = new Map<string, ('L' | 'R' | 'T' | 'B')[]>([
  ['a', ['L', 'R', 'T', 'B']],
  ['b', ['T', 'B']],
])

function plan(placements: Placement[]): CutPlan {
  return {
    id: '',
    createdAt: 0,
    sheets: [{ sheetIndex: 0, sheetSpecId: 's1', placements }],
    sheetLibrary: [sheetA],
    stats: {
      sheetCount: 1,
      utilization: 80,
      totalCost: 0,
      wasteArea: 1000,
      reusableWasteBlocks: 0,
      largestReusableWaste: 0,
    },
    settings,
  }
}

const prefs = (p: Partial<PricingPrefs>): PricingPrefs => ({ ...DEFAULT_PRICING, ...p })

describe('calcCost · 每样精算（itemized）', () => {
  it('总成本 = 板材费 + 封边费 + 加工费，构成分开返回', () => {
    const p = plan([
      // a：1000×500 全封边（周长 = 2×1000 + 2×500 = 3000mm），b：600×400 上下封边（2×600 = 1200mm）
      { partId: 'a', instance: 0, x: 0, y: 0, len: 1000, wid: 500, rotated: false },
      { partId: 'b', instance: 0, x: 0, y: 503, len: 600, wid: 400, rotated: false },
    ])
    const c = calcCost(p, price, prefs({ edgePricePerM: 2, processingFeePerSheet: 15 }), edgeBands)
    expect(c.sheetCost).toBe(100) // 1 张 s1
    expect(c.edgeCost).toBeCloseTo((3000 / 1000) * 2 + (1200 / 1000) * 2, 6) // 6 + 2.4 = 8.4
    expect(c.processingCost).toBe(15)
    expect(c.totalCost).toBeCloseTo(100 + 8.4 + 15, 6)
  })

  it('多规格板材按每张实际单价累加', () => {
    const p: CutPlan = {
      ...plan([]),
      sheets: [
        { sheetIndex: 0, sheetSpecId: 's1', placements: [] },
        { sheetIndex: 1, sheetSpecId: 's2', placements: [] },
      ],
      sheetLibrary: [sheetA, sheetB],
    }
    expect(calcCost(p, price, prefs({ processingFeePerSheet: 0 }), edgeBands).sheetCost).toBe(100 + 92)
  })

  it('无封边的零件不计封边费', () => {
    const p = plan([{ partId: 'c', instance: 0, x: 0, y: 0, len: 1000, wid: 500, rotated: false }])
    const c = calcCost(p, price, prefs({ processingFeePerSheet: 0 }), new Map())
    expect(c.edgeCost).toBe(0)
  })
})

describe('calcCost · 按面积计价（byArea）', () => {
  it('总成本 = 零件总面积(m²) × 面积单价', () => {
    const p = plan([
      { partId: 'a', instance: 0, x: 0, y: 0, len: 2000, wid: 1000, rotated: false },
      { partId: 'b', instance: 0, x: 0, y: 1003, len: 1000, wid: 500, rotated: false },
    ])
    // 总面积 = 2e6 + 5e5 = 2.5 m²
    const c = calcCost(p, price, prefs({ mode: 'byArea', areaPricePerSqm: 120 }), edgeBands)
    expect(c.sheetCost).toBe(0)
    expect(c.edgeCost).toBe(0)
    expect(c.processingCost).toBe(0)
    expect(c.totalCost).toBeCloseTo(2.5 * 120, 6)
  })
})

describe('calcCost · 关闭与分摊', () => {
  it('关闭价格核算：totalCost 为 0，无分摊', () => {
    const p = plan([
      { partId: 'a', instance: 0, x: 0, y: 0, len: 1000, wid: 500, rotated: false },
    ])
    const c = calcCost(p, price, prefs({ enabled: false }), edgeBands)
    expect(c.totalCost).toBe(0)
    expect(c.perPartCost.a).toBe(0)
  })

  it('每零件分摊按面积占比（两种模式通用）', () => {
    const p = plan([
      { partId: 'a', instance: 0, x: 0, y: 0, len: 600, wid: 400, rotated: false },
      { partId: 'b', instance: 0, x: 0, y: 403, len: 200, wid: 200, rotated: false },
    ])
    // 面积：a=240000, b=40000，总 280000；a 占 240000/280000 × 100
    const c = calcCost(p, price, prefs({ processingFeePerSheet: 0 }), new Map())
    expect(c.perPartCost.a).toBeCloseTo((240000 / 280000) * 100, 6)
    expect(c.perPartCost.b).toBeCloseTo((40000 / 280000) * 100, 6)
  })

  it('空方案总成本为 0，无分摊', () => {
    const empty: CutPlan = { ...plan([]), sheets: [] }
    const c = calcCost(empty, price, prefs({ mode: 'byArea', areaPricePerSqm: 120 }), edgeBands)
    expect(c.totalCost).toBe(0)
    expect(Object.keys(c.perPartCost)).toHaveLength(0)
  })

  it('utilization / wasteArea 透传', () => {
    const c = calcCost(plan([]), price, prefs({ processingFeePerSheet: 0 }), edgeBands)
    expect(c.utilization).toBe(80)
    expect(c.wasteArea).toBe(1000)
  })
})

describe('planCost · 按当前计价模式选快照', () => {
  it('新方案（含双模式快照）按 mode 取值', () => {
    const stats: PlanStats = { sheetCount: 1, utilization: 80, totalCost: 0, wasteArea: 0, reusableWasteBlocks: 0, largestReusableWaste: 0, costItemized: 123, costByArea: 240 }
    expect(planCost(stats, prefs({ mode: 'itemized' }))).toBe(123)
    expect(planCost(stats, prefs({ mode: 'byArea' }))).toBe(240)
  })

  it('旧历史方案（无快照）回退 totalCost', () => {
    const stats: PlanStats = { sheetCount: 1, utilization: 80, totalCost: 88, wasteArea: 0, reusableWasteBlocks: 0, largestReusableWaste: 0 }
    expect(planCost(stats, prefs({ mode: 'itemized' }))).toBe(88)
    expect(planCost(stats, prefs({ mode: 'byArea' }))).toBe(88)
  })
})
