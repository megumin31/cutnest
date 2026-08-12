/**
 * planStore 单测 ——
 * 1. selectPart 选中联动翻页语义；
 * 2. listPlans 排序方向（真实 Dexie + fake-indexeddb）：降序契约（最新在前）、reverse() 必要性；
 * 3. saveToHistory 历史落库：id/createdAt 分配、去重不新增、50 条上限裁剪方向、
 *    遗留超限收敛、historyRev 刷新信号。
 * storage 走真实实现（fake-indexeddb/auto 注入 IndexedDB），不 mock 排序/分配假设。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { usePlanStore, partKey } from '../src/features/cutting/planStore'
import { planFingerprint } from '../src/features/cutting/planFingerprint'
import { db, storage } from '../src/infra/storage'
import type { CutPlan, PlanRecord, Project, SheetSpec } from '../src/domain/types'
import { createDefaultSettings } from '../src/domain/materials'

const sheet: SheetSpec = { id: 's1', name: '颗粒板', length: 2440, width: 1220, price: 98 }

/** seq 直接进入 partId 与尺寸 → 不同 seq 不同指纹（同 seq 内容全等） */
function makePlan(seq: number): CutPlan {
  return {
    id: '',
    createdAt: 0,
    sheets: [
      {
        sheetIndex: 0,
        sheetSpecId: 's1',
        placements: [{ partId: `p${seq}`, instance: 0, x: 0, y: 0, len: 1000 + seq, wid: 500, rotated: false }],
      },
    ],
    sheetLibrary: [sheet],
    stats: { sheetCount: 1, utilization: 50, totalCost: 0, wasteArea: 0, reusableWasteBlocks: 0, largestReusableWaste: 0 },
    settings: createDefaultSettings(),
  }
}

function makeProject(id: string): Project {
  return {
    id,
    name: '测试项目',
    parts: [{ id: 'p1', name: '侧板', length: 1000, width: 500, quantity: 1 }],
    sheets: [sheet],
    settings: createDefaultSettings(),
    exportPrefs: {
      pdf: { watermark: { enabled: false, text: '' }, companyInfo: { name: '' } },
      dxf: { cutDirection: 'climb' },
      unit: 'mm',
    },
    createdAt: 0,
    updatedAt: 0,
  }
}

/** 项目零件名快照（fingerprint 计算用，与 makeProject 一致） */
const PART_NAMES = { p1: '侧板' }

function twoSheetPlan(): CutPlan {
  return {
    id: '',
    createdAt: 0,
    sheets: [
      {
        sheetIndex: 0,
        sheetSpecId: 's1',
        placements: [{ partId: 'a', instance: 0, x: 0, y: 0, len: 1000, wid: 500, rotated: false }],
      },
      {
        sheetIndex: 1,
        sheetSpecId: 's1',
        placements: [{ partId: 'b', instance: 0, x: 0, y: 0, len: 800, wid: 400, rotated: false }],
      },
    ],
    sheetLibrary: [sheet],
    stats: { sheetCount: 2, utilization: 50, totalCost: 0, wasteArea: 0, reusableWasteBlocks: 0, largestReusableWaste: 0 },
    settings: createDefaultSettings(),
  }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  usePlanStore.setState({ historyRev: 0 })
})

describe('selectPart', () => {
  beforeEach(() => {
    usePlanStore.setState({ plan: twoSheetPlan(), sheetIndex: 0, selectedPartKey: null })
  })

  it('选中当前页零件：不跳页', () => {
    const key = partKey('a', 0)
    usePlanStore.getState().selectPart(key)
    const s = usePlanStore.getState()
    expect(s.selectedPartKey).toBe(key)
    expect(s.sheetIndex).toBe(0)
  })

  it('选中他页零件：右栏跳到所在板', () => {
    const key = partKey('b', 0)
    usePlanStore.getState().selectPart(key)
    const s = usePlanStore.getState()
    expect(s.selectedPartKey).toBe(key)
    expect(s.sheetIndex).toBe(1)
  })

  it('清空（null）：清除选中但不跳页', () => {
    usePlanStore.getState().selectPart(partKey('b', 0))
    usePlanStore.getState().selectPart(null)
    const s = usePlanStore.getState()
    expect(s.selectedPartKey).toBeNull()
    expect(s.sheetIndex).toBe(1)
  })

  it('选中不存在的零件：跳页保持', () => {
    usePlanStore.getState().selectPart('ghost#0')
    const s = usePlanStore.getState()
    expect(s.selectedPartKey).toBe('ghost#0')
    expect(s.sheetIndex).toBe(0)
  })
})

describe('listPlans 排序方向', () => {
  it('乱序插入 createdAt，返回应为降序（最新在前）', async () => {
    const projectId = 'proj-order'
    const recs: PlanRecord[] = [
      { id: 'a', projectId, projectName: 'x', plan: makePlan(1), sheets: [sheet], createdAt: 100 },
      { id: 'b', projectId, projectName: 'x', plan: makePlan(2), sheets: [sheet], createdAt: 300 },
      { id: 'c', projectId, projectName: 'x', plan: makePlan(3), sheets: [sheet], createdAt: 200 },
      { id: 'd', projectId, projectName: 'x', plan: makePlan(4), sheets: [sheet], createdAt: 500 },
      { id: 'e', projectId, projectName: 'x', plan: makePlan(5), sheets: [sheet], createdAt: 400 },
    ]
    for (const r of recs) await db.cutPlans.put(r)

    const list = await storage.listPlans(projectId)
    expect(list.map((r) => r.id)).toEqual(['d', 'e', 'b', 'c', 'a']) // 降序 500,400,300,200,100
  })

  it('去掉 .reverse() 后 sortBy 返回升序（最旧在前）—— 不能去掉', async () => {
    const projectId = 'proj-order2'
    const recs: PlanRecord[] = [
      { id: 'a', projectId, projectName: 'x', plan: makePlan(1), sheets: [sheet], createdAt: 100 },
      { id: 'b', projectId, projectName: 'x', plan: makePlan(2), sheets: [sheet], createdAt: 300 },
      { id: 'c', projectId, projectName: 'x', plan: makePlan(3), sheets: [sheet], createdAt: 200 },
      { id: 'd', projectId, projectName: 'x', plan: makePlan(4), sheets: [sheet], createdAt: 500 },
      { id: 'e', projectId, projectName: 'x', plan: makePlan(5), sheets: [sheet], createdAt: 400 },
    ]
    for (const r of recs) await db.cutPlans.put(r)

    const list = await db.cutPlans.where('projectId').equals(projectId).sortBy('createdAt')
    expect(list.map((r) => r.id)).toEqual(['a', 'c', 'b', 'e', 'd']) // 升序 100,200,300,400,500
  })
})

describe('saveToHistory', () => {
  it('新增记录：id/createdAt 由 storage 分配，fingerprint 与零件快照落库', async () => {
    const project = makeProject('proj-new')
    await usePlanStore.getState().saveToHistory(project, makePlan(1))
    const list = await storage.listPlans(project.id)
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBeTruthy()
    expect(list[0]!.createdAt).toBeGreaterThan(0)
    expect(list[0]!.fingerprint).toBe(planFingerprint(makePlan(1), PART_NAMES))
    expect(list[0]!.parts).toEqual(project.parts)
    expect(list[0]!.partNames).toEqual(PART_NAMES)
  })

  it('达到上限（50）后新增：删除最旧、保留最新（连续两次裁剪）', async () => {
    const project = makeProject('proj-trim')
    const now = Date.now()
    // 预置 50 条旧记录：createdAt 从 now-50000 到 now-1000（old-1 最旧 → old-50 最新）
    for (let i = 1; i <= 50; i++) {
      await db.cutPlans.put({
        id: `old-${i}`,
        projectId: project.id,
        projectName: project.name,
        plan: makePlan(1000 + i),
        sheets: [sheet],
        createdAt: now - (51 - i) * 1000,
        fingerprint: `fp-old-${i}`,
      })
    }
    expect(await db.cutPlans.count()).toBe(50)

    // 第 51 条：触发裁剪
    await usePlanStore.getState().saveToHistory(project, makePlan(1))
    expect(await db.cutPlans.count()).toBe(50)
    // 第 52 条：再触发裁剪
    await usePlanStore.getState().saveToHistory(project, makePlan(2))
    expect(await db.cutPlans.count()).toBe(50)

    // 验证：被删的是最旧（old-1、old-2），保留的 = old-3..old-50 + 两条新记录
    const all = await storage.listPlans(project.id)
    const ids = all.map((r) => r.id)
    expect(ids.includes('old-1')).toBe(false)
    expect(ids.includes('old-2')).toBe(false)
    expect(ids.length).toBe(50)
    // 全部剩余记录的 createdAt ≥ 最旧保留边界（old-3 的 createdAt = now - 48000）
    const minKept = Math.min(...all.map((r) => r.createdAt))
    expect(minKept).toBeGreaterThanOrEqual(now - 48000 - 100) // 含精度余量
  })

  it('重复计算（同指纹）不新增：保留原 id 与首次 createdAt', async () => {
    const project = makeProject('proj-dup')
    await usePlanStore.getState().saveToHistory(project, makePlan(10))
    const before = await storage.listPlans(project.id)
    expect(before).toHaveLength(1)
    await usePlanStore.getState().saveToHistory(project, makePlan(10))
    const after = await storage.listPlans(project.id)
    expect(after).toHaveLength(1) // 不新增
    expect(after[0]!.id).toBe(before[0]!.id) // 保留原 id
    expect(after[0]!.createdAt).toBe(before[0]!.createdAt) // 保留首次 createdAt
  })

  it('遗留超限（51 条）时 dup 覆盖同样收敛到 50', async () => {
    const project = makeProject('proj-over')
    const plan = makePlan(7)
    // 预置 51 条，其中 old-0 的指纹与 plan 一致（模拟"之前算过、历史已超限"的遗留态）
    for (let i = 0; i < 51; i++) {
      const same = i === 0
      await db.cutPlans.put({
        id: `old-${i}`,
        projectId: project.id,
        projectName: project.name,
        plan: same ? plan : makePlan(i),
        sheets: [sheet],
        createdAt: 1000 + i,
        fingerprint: same ? planFingerprint(plan, PART_NAMES) : undefined,
      })
    }
    await usePlanStore.getState().saveToHistory(project, plan)
    const list = await storage.listPlans(project.id)
    expect(list).toHaveLength(50) // dup 覆盖后同样收敛
    expect(list.some((r) => r.id === 'old-0')).toBe(false) // 最旧（createdAt 1000）被删
  })

  it('落库成功后 historyRev 递增（历史列表刷新信号）', async () => {
    const project = makeProject('proj-rev')
    expect(usePlanStore.getState().historyRev).toBe(0)
    await usePlanStore.getState().saveToHistory(project, makePlan(1))
    expect(usePlanStore.getState().historyRev).toBe(1)
    await usePlanStore.getState().saveToHistory(project, makePlan(1))
    expect(usePlanStore.getState().historyRev).toBe(2) // dup 覆盖也触发刷新
  })
})
