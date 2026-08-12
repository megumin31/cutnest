/**
 * continueFromHistory 参数化语义单测（F2）——
 * 1. 显式传 record：恢复该记录（不依赖"当前打开了哪条方案"）；
 * 2. 无参：恢复当前打开的方案（顶栏按钮语义）；
 * 3. 无参且未打开历史方案：返回 false。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, storage } from '../src/infra/storage'
import { usePlanStore } from '../src/features/cutting/planStore'
import { useProjectStore } from '../src/features/projects/projectStore'
import { continueFromHistory } from '../src/features/cutting/historyActions'
import type { CutPlan, PlanRecord, Project, SheetSpec } from '../src/domain/types'
import { qty } from '../src/domain/types'
import { createDefaultSettings } from '../src/domain/materials'

const sheet: SheetSpec = { id: 's1', name: '颗粒板', length: 2440, width: 1220, price: 98 }

function makePlan(partId: string, len: number): CutPlan {
  return {
    id: '',
    createdAt: 0,
    sheets: [
      {
        sheetIndex: 0,
        sheetSpecId: 's1',
        placements: [{ partId, instance: 0, x: 0, y: 0, len, wid: 500, rotated: false }],
      },
    ],
    sheetLibrary: [sheet],
    stats: { sheetCount: 1, utilization: 50, totalCost: 0, wasteArea: 0, reusableWasteBlocks: 0, largestReusableWaste: 0 },
    settings: createDefaultSettings(),
  }
}

const project: Project = {
  id: 'p1',
  name: '项目',
  parts: [],
  sheets: [sheet],
  settings: createDefaultSettings(),
  exportPrefs: { pdf: { watermark: { enabled: false, text: '' }, companyInfo: { name: '' } }, dxf: { cutDirection: 'climb' }, unit: 'mm' },
  createdAt: 0,
  updatedAt: 0,
}

/** A 方案：零件"甲"；B 方案：零件"乙" */
const recA: PlanRecord = {
  id: 'recA',
  projectId: 'p1',
  projectName: '项目',
  plan: makePlan('a', 1000),
  sheets: [sheet],
  createdAt: 1000,
  partNames: { a: '甲' },
  parts: [{ id: 'a', name: '甲', length: 1000, width: 500, quantity: qty(1) }],
}
const recB: PlanRecord = {
  id: 'recB',
  projectId: 'p1',
  projectName: '项目',
  plan: makePlan('b', 2000),
  sheets: [sheet],
  createdAt: 2000,
  partNames: { b: '乙' },
  parts: [{ id: 'b', name: '乙', length: 2000, width: 500, quantity: qty(1) }],
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  await storage.saveProject(project)
  await storage.savePlan(recA)
  await storage.savePlan(recB)
  await useProjectStore.getState().openProject('p1')
})

describe('continueFromHistory 参数化', () => {
  it('显式传 record：恢复该记录，与"当前打开"状态无关', async () => {
    // 未打开任何方案：直接以 B 记录为目标
    const ok = continueFromHistory(recB)
    expect(ok).toBe(true)
    const parts = useProjectStore.getState().current?.parts ?? []
    expect(parts.map((p) => p.name)).toEqual(['乙'])
    expect(parts[0]!.length).toBe(2000)
    // 成功后进入编辑态（plan 被 reset 清空）
    expect(usePlanStore.getState().plan).toBeNull()
    expect(usePlanStore.getState().planIsHistory).toBe(false)
  })

  it('显式传 record：即使当前打开的是另一条，也恢复目标记录', async () => {
    usePlanStore.getState().openHistory(recA) // 当前打开 A
    const ok = continueFromHistory(recB) // 目标是 B
    expect(ok).toBe(true)
    const parts = useProjectStore.getState().current?.parts ?? []
    expect(parts.map((p) => p.name)).toEqual(['乙']) // 恢复 B，不是 A
  })

  it('无参：恢复当前打开的方案（顶栏按钮语义）', async () => {
    usePlanStore.getState().openHistory(recA)
    const ok = continueFromHistory()
    expect(ok).toBe(true)
    const parts = useProjectStore.getState().current?.parts ?? []
    expect(parts.map((p) => p.name)).toEqual(['甲'])
  })

  it('无参且未打开历史方案：返回 false', async () => {
    const ok = continueFromHistory()
    expect(ok).toBe(false)
    expect(useProjectStore.getState().current?.parts ?? []).toEqual([])
  })
})
