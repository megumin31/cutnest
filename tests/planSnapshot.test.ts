/**
 * planSnapshot 单测 —— 历史方案从排样结果聚合重建零件表（旧记录无 parts 快照时的兜底）。
 */
import { describe, expect, it } from 'vitest'
import { rebuildPartsFromPlan } from '../src/features/cutting/planSnapshot'
import type { CutPlan } from '../src/domain/types'

function planOf(placements: CutPlan['sheets'][number]['placements']): CutPlan {
  return {
    id: '',
    createdAt: 0,
    sheets: [{ sheetIndex: 0, sheetSpecId: 's1', placements }],
    sheetLibrary: [],
    stats: { sheetCount: 1, utilization: 1, totalCost: 0, wasteArea: 0, reusableWasteBlocks: 0, largestReusableWaste: 0 },
    settings: { kerf: 3, trimAllowance: 0, seed: 1, quality: 'standard', minReusableWaste: 200 },
  }
}

describe('rebuildPartsFromPlan', () => {
  it('按 partId 聚合实例数量并回填名字', () => {
    const plan = planOf([
      { partId: 'a', instance: 0, x: 0, y: 0, len: 1000, wid: 400, rotated: false },
      { partId: 'a', instance: 1, x: 0, y: 403, len: 1000, wid: 400, rotated: false },
      { partId: 'b', instance: 0, x: 0, y: 0, len: 500, wid: 300, rotated: false },
    ])
    const parts = rebuildPartsFromPlan(plan, { a: '侧板', b: '层板' })
    expect(parts).toHaveLength(2)
    const a = parts.find((p) => p.id === 'a')!
    expect(a.name).toBe('侧板')
    expect(a.quantity).toBe(2)
    expect(a.length).toBe(1000)
    expect(a.width).toBe(400)
    const b = parts.find((p) => p.id === 'b')!
    expect(b.name).toBe('层板')
    expect(b.quantity).toBe(1)
  })

  it('旋转实例还原未旋转尺寸（rotated 时 length/width 交换）', () => {
    const plan = planOf([
      { partId: 'a', instance: 0, x: 0, y: 0, len: 400, wid: 1000, rotated: true },
    ])
    const parts = rebuildPartsFromPlan(plan, null)
    expect(parts[0].length).toBe(1000)
    expect(parts[0].width).toBe(400)
  })

  it('空排样返回空表；名字缺省回退 partId；grain 取安全默认 alongLength', () => {
    const plan = planOf([])
    expect(rebuildPartsFromPlan(plan, null)).toEqual([])

    const p2 = planOf([{ partId: 'x', instance: 0, x: 0, y: 0, len: 10, wid: 5, rotated: false }])
    const parts = rebuildPartsFromPlan(p2, null)
    expect(parts[0].name).toBe('x')
    expect(parts[0].grain).toBe('alongLength')
  })
})
