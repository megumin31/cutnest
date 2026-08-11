/**
 * 历史方案去重单测 —— 指纹稳定性 + 去重判定（同输入 → 同指纹 → 不重复新增）。
 */
import { describe, it, expect } from 'vitest'
import { planFingerprint, findDuplicatePlan } from '../src/features/cutting/planFingerprint'
import type { CutPlan, PlanRecord } from '../src/domain/types'
import { createDefaultSettings } from '../src/domain/materials'

const sheet = { id: 's1', name: '颗粒板', length: 2440, width: 1220, price: 98 }

function plan(overrides: Partial<CutPlan> = {}): CutPlan {
  return {
    id: 'p1',
    createdAt: 111,
    sheets: [
      { sheetIndex: 0, sheetSpecId: 's1', placements: [{ partId: 'a', instance: 0, x: 0, y: 0, len: 1000, wid: 500, rotated: false }] },
    ],
    sheetLibrary: [sheet],
    stats: { sheetCount: 1, utilization: 40, totalCost: 100, wasteArea: 0, reusableWasteBlocks: 0, largestReusableWaste: 0 },
    settings: createDefaultSettings(),
    ...overrides,
  }
}

const names = { a: '侧板' }

describe('planFingerprint', () => {
  it('同输入同指纹（id/createdAt 变化不影响）', () => {
    const p1 = plan({ id: 'x', createdAt: 1 })
    const p2 = plan({ id: 'y', createdAt: 2 }) // 仅 id/createdAt 不同
    expect(planFingerprint(p1, names)).toBe(planFingerprint(p2, names))
  })

  it('布局变化 → 指纹变化', () => {
    const p1 = plan()
    const p2 = plan({ sheets: [{ ...p1.sheets[0], placements: [{ partId: 'a', instance: 0, x: 100, y: 200, len: 1000, wid: 500, rotated: false }] }] })
    expect(planFingerprint(p1, names)).not.toBe(planFingerprint(p2, names))
  })

  it('零件名快照变化 → 指纹变化（名字属档案内容）', () => {
    expect(planFingerprint(plan(), names)).not.toBe(planFingerprint(plan(), { a: '新名字' }))
  })

  it('工艺参数/设置变化 → 指纹变化', () => {
    expect(planFingerprint(plan(), names)).not.toBe(
      planFingerprint(plan({ settings: createDefaultSettings({ kerf: 5 }) }), names),
    )
  })
})

describe('findDuplicatePlan', () => {
  const p = plan()
  const fp = planFingerprint(p, names)
  const record = (over: Partial<PlanRecord> = {}): PlanRecord => ({
    id: 'r1',
    projectId: 'proj',
    projectName: '项目',
    plan: p,
    sheets: [sheet],
    createdAt: 100,
    partNames: names,
    fingerprint: fp,
    ...over,
  })

  it('同指纹 + 内容一致 → 判重（跳过保存）', () => {
    expect(findDuplicatePlan([record()], fp, plan())?.id).toBe('r1')
  })

  it('指纹相同但内容不同（哈希碰撞）→ 不判重，以内容全等为准', () => {
    const other = plan({ sheets: [{ ...p.sheets[0], placements: [{ partId: 'a', instance: 0, x: 5, y: 5, len: 1000, wid: 500, rotated: false }] }] })
    // 强制同指纹（碰撞场景）
    expect(findDuplicatePlan([record({ fingerprint: 'fp-same' })], 'fp-same', other)).toBeUndefined()
  })

  it('旧数据无指纹 → 不参与去重', () => {
    expect(findDuplicatePlan([record({ fingerprint: undefined })], fp, plan())).toBeUndefined()
  })

  it('内容一致但指纹不同 → 不判重', () => {
    expect(findDuplicatePlan([record({ fingerprint: 'fp-other' })], fp, plan())).toBeUndefined()
  })
})
