/**
 * validator 单测 —— 必须能拦截：重叠 / 越界 / 切缝不足（架构文档 §7 专项要求）。
 */
import { describe, it, expect } from 'vitest'
import { validatePlan } from '../src/domain/optimizer/validator'
import type { CutPlan, Part, Placement, SheetSpec, OptimizeSettings } from '../src/domain/types'
import { createDefaultSettings } from '../src/domain/materials'

const sheet: SheetSpec = { id: 's1', name: '2440×1220', length: 2440, width: 1220, price: 100 }
const parts: Part[] = [{ id: 'a', name: 'A', length: 1000, width: 500, quantity: 2 }]
const settings: OptimizeSettings = createDefaultSettings()

function placement(overrides: Partial<Placement>): Placement {
  return { partId: 'a', instance: 0, x: 0, y: 0, len: 1000, wid: 500, rotated: false, ...overrides }
}

function plan(ps: Placement[]): CutPlan {
  return {
    id: '',
    createdAt: 0,
    sheets: [{ sheetIndex: 0, sheetSpecId: 's1', placements: ps }],
    sheetLibrary: [sheet],
    stats: {
      sheetCount: 1,
      utilization: 50,
      totalCost: 0,
      wasteArea: 0,
      reusableWasteBlocks: 0,
      largestReusableWaste: 0,
    },
    settings,
  }
}

describe('validator', () => {
  it('合法方案通过', () => {
    const p = plan([
      placement({ instance: 0, x: 0, y: 0 }),
      placement({ instance: 1, x: 1003, y: 0 }),
    ])
    const v = validatePlan(p, parts, [sheet], settings)
    expect(v.ok).toBe(true)
  })

  it('拦截重叠', () => {
    const p = plan([
      placement({ instance: 0, x: 0, y: 0 }),
      placement({ instance: 1, x: 500, y: 0 }),
    ])
    const v = validatePlan(p, parts, [sheet], settings)
    expect(v.ok).toBe(false)
    expect(v.errors.join('')).toContain('净距不足')
  })

  it('拦截切缝不足（间隙 < kerf）', () => {
    // 间隙 1mm < kerf 3mm
    const p = plan([
      placement({ instance: 0, x: 0, y: 0 }),
      placement({ instance: 1, x: 1001, y: 0 }),
    ])
    const v = validatePlan(p, parts, [sheet], settings)
    expect(v.ok).toBe(false)
    expect(v.errors.join('')).toContain('净距不足')
  })

  it('拦截越界', () => {
    const p = plan([placement({ instance: 0, x: 0, y: 0 }), placement({ instance: 1, x: 2441, y: 0 })])
    const v = validatePlan(p, parts, [sheet], settings)
    expect(v.ok).toBe(false)
    expect(v.errors.join('')).toContain('越出')
  })

  it('拦截缺失实例（零件未排完）', () => {
    const p = plan([placement({ instance: 0, x: 0, y: 0 })])
    const v = validatePlan(p, parts, [sheet], settings)
    expect(v.ok).toBe(false)
    expect(v.errors.join('')).toContain('缺少')
  })

  it('拦截违反旋转约束', () => {
    const partsFixed: Part[] = [{ id: 'a', name: 'A', length: 1000, width: 500, quantity: 1, grain: 'alongLength' }]
    const p = plan([placement({ rotated: true, len: 500, wid: 1000 })])
    const v = validatePlan(p, partsFixed, [sheet], settings)
    expect(v.ok).toBe(false)
    expect(v.errors.join('')).toContain('旋转')
  })

  it('grain 缺省（未勾选旋转）的零件旋转即拦截', () => {
    const partsNoGrain: Part[] = [{ id: 'a', name: 'A', length: 1000, width: 500, quantity: 1 }]
    const p = plan([placement({ rotated: true, len: 500, wid: 1000 })])
    const v = validatePlan(p, partsNoGrain, [sheet], settings)
    expect(v.ok).toBe(false)
    expect(v.errors.join('')).toContain('旋转')
  })

  it('指定板材的零件出现在非指定规格的板即拦截', () => {
    const partsFixed: Part[] = [{ id: 'a', name: 'A', length: 1000, width: 500, quantity: 1, sheetId: 's2' }]
    const sheet2: SheetSpec = { id: 's2', name: '1200×600', length: 1200, width: 600, price: 40 }
    const p: CutPlan = {
      ...plan([]),
      sheets: [{ sheetIndex: 0, sheetSpecId: 's1', placements: [placement({ instance: 0, x: 0, y: 0 })] }],
      sheetLibrary: [sheet, sheet2],
    }
    const v = validatePlan(p, partsFixed, [sheet, sheet2], settings)
    expect(v.ok).toBe(false)
    expect(v.errors.join('')).toContain('指定板材')
  })

  it('拦截尺寸与输入不符', () => {
    const p = plan([placement({ instance: 0, len: 999, wid: 500 })])
    const v = validatePlan(p, parts, [sheet], settings)
    expect(v.ok).toBe(false)
    expect(v.errors.join('')).toContain('尺寸')
  })
})
