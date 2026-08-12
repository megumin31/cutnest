/**
 * HistoryPanel 历史行交互组件级回归（jsdom 真实渲染）——
 * F1/F2 修复后行为：
 * 1. 鼠标路径：打开 A 后点 B 行 ⋯ → 继续编辑 → 恢复 B（显式目标，与打开状态无关）；
 * 2. 键盘路径：焦点在 ⋯ 按钮上按 Enter → 不误打开行（onKeyDown 守卫），继续编辑仍恢复 B。
 */
// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { describe, expect, it, beforeAll, beforeEach } from 'vitest'
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/react'
import { ConfigProvider, App as AntApp } from 'antd'
import { initI18n } from '../src/features/i18n'
import { db, storage } from '../src/infra/storage'
import { usePlanStore } from '../src/features/cutting/planStore'
import { useProjectStore } from '../src/features/projects/projectStore'
import { HistoryPanel } from '../src/ui/HistoryPanel'
import type { CutPlan, PlanRecord, Project, SheetSpec } from '../src/domain/types'
import { createDefaultSettings } from '../src/domain/materials'

// antd 在 jsdom 下需要 matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

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

/** A 方案：零件"甲"；B 方案：零件"乙"（明显不同，判别用） */
const recA: PlanRecord = {
  id: 'recA',
  projectId: 'p1',
  projectName: '项目',
  plan: makePlan('a', 1000),
  sheets: [sheet],
  createdAt: 1000,
  partNames: { a: '甲' },
  parts: [{ id: 'a', name: '甲', length: 1000, width: 500, quantity: 1 }],
}
const recB: PlanRecord = {
  id: 'recB',
  projectId: 'p1',
  projectName: '项目',
  plan: makePlan('b', 2000),
  sheets: [sheet],
  createdAt: 2000,
  partNames: { b: '乙' },
  parts: [{ id: 'b', name: '乙', length: 2000, width: 500, quantity: 1 }],
}

/** 渲染 HistoryPanel 并展开历史列表，返回 [B行, A行]（降序：最新在前） */
async function renderPanel(): Promise<[Element, Element]> {
  render(
    <ConfigProvider>
      <AntApp>
        <HistoryPanel />
      </AntApp>
    </ConfigProvider>,
  )
  fireEvent.click(screen.getByText('历史方案'))
  await waitFor(() => {
    expect(document.querySelectorAll('.collapse-card [role="button"]').length).toBe(2)
  })
  const rows = document.querySelectorAll('.collapse-card [role="button"]')
  return [rows[0]!, rows[1]!]
}

beforeAll(async () => {
  await initI18n('zh')
})

beforeEach(async () => {
  cleanup() // 每次用例前清理上次渲染的 DOM（vitest 未开 globals，无自动 cleanup）
  await db.delete()
  await db.open()
  await storage.saveProject(project)
  await storage.savePlan(recA)
  await storage.savePlan(recB)
  await useProjectStore.getState().openProject('p1')
})

describe('HistoryPanel 历史行交互（F1/F2 回归）', () => {
  it('鼠标路径：打开 A 后点 B 行 ⋯ → 继续编辑 → 恢复 B（显式目标）', async () => {
    const [rowB, rowA] = await renderPanel()

    // 打开 A 行查看
    fireEvent.click(rowA)
    expect(usePlanStore.getState().planPartNames).toEqual({ a: '甲' })

    // 精确点击 B 行的 ⋯ 按钮（程序化命中按钮，模拟无误差点击）
    const btnB = rowB.querySelector('button[aria-label="方案操作"]')!
    fireEvent.click(btnB)
    await waitFor(() => screen.getByText('继续编辑'))
    // 点 ⋯ 不应打开 B 行（stopPropagation 生效，plan 仍是 A）
    expect(usePlanStore.getState().planPartNames).toEqual({ a: '甲' })

    // 点「继续编辑」→ 恢复的必须是 B（显式传行，与当前打开状态无关）
    fireEvent.click(screen.getByText('继续编辑'))
    const parts = useProjectStore.getState().current?.parts ?? []
    expect(parts.map((p) => p.name)).toEqual(['乙'])
    expect(parts[0]!.length).toBe(2000)
  })

  it('键盘路径：焦点在 ⋯ 上按 Enter → 不误打开行（onKeyDown 守卫）', async () => {
    const [rowB, rowA] = await renderPanel()

    fireEvent.click(rowA)
    expect(usePlanStore.getState().planPartNames).toEqual({ a: '甲' })

    // 焦点在 ⋯ 按钮上按 Enter：keydown 冒泡到行 div，必须被守卫拦截（不打开 B 行）
    const btnB = rowB.querySelector('button[aria-label="方案操作"]')!
    fireEvent.keyDown(btnB, { key: 'Enter' })
    expect(usePlanStore.getState().planPartNames).toEqual({ a: '甲' }) // 修复前这里会变成 { b: '乙' }

    // 浏览器中 Enter 在 button 上还会触发 click（打开菜单）；随后继续编辑仍恢复 B
    fireEvent.click(btnB)
    await waitFor(() => screen.getByText('继续编辑'))
    fireEvent.click(screen.getByText('继续编辑'))
    const parts = useProjectStore.getState().current?.parts ?? []
    expect(parts.map((p) => p.name)).toEqual(['乙'])
  })

  it('行自身聚焦按 Enter：仍正常打开该行（无障碍语义保留）', async () => {
    const [, rowA] = await renderPanel()
    fireEvent.keyDown(rowA, { key: 'Enter' })
    expect(usePlanStore.getState().planIsHistory).toBe(true)
    expect(usePlanStore.getState().planPartNames).toEqual({ a: '甲' })
  })

  it('行自身聚焦按 Space：正常打开该行（role=button 键盘契约完整）', async () => {
    const [, rowA] = await renderPanel()
    fireEvent.keyDown(rowA, { key: ' ' })
    expect(usePlanStore.getState().planIsHistory).toBe(true)
    expect(usePlanStore.getState().planPartNames).toEqual({ a: '甲' })
  })
})
