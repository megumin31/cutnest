/**
 * Excel 式键盘漫游（gridKeyboard.ts + PartsWorkspace 接线）——
 * 方向键在单元格间移动焦点（不触发 InputNumber 步进），
 * 最后一行 ↓ 新增一行并聚焦新行同列；Enter 下移。
 */
// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { describe, expect, it, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { ConfigProvider, App as AntApp } from 'antd'
import { initI18n } from '../src/features/i18n'
import { useProjectStore } from '../src/features/projects/projectStore'
import { usePlanStore } from '../src/features/cutting/planStore'
import { PartsWorkspace } from '../src/ui/PartsWorkspace'
import type { Project, SheetSpec } from '../src/domain/types'
import { qty } from '../src/domain/types'
import { createDefaultSettings } from '../src/domain/materials'

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

function makeProject(): Project {
  return {
    id: 'proj-key',
    name: '键盘测试',
    parts: [
      { id: 'p1', name: '侧板', length: 2400, width: 400, quantity: qty(4), grain: 'alongLength' },
      { id: 'p2', name: '抽屉面', length: 1200, width: 400, quantity: qty(8), grain: 'any' },
    ],
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

function renderWorkspace() {
  const { container } = render(
    <ConfigProvider>
      <AntApp>
        <PartsWorkspace />
      </AntApp>
    </ConfigProvider>,
  )
  return container
}

beforeEach(() => {
  initI18n('zh')
  usePlanStore.setState({ inputFingerprint: null, plan: null, status: 'idle', planIsHistory: false, planParts: null })
  useProjectStore.setState({ current: makeProject(), projects: [], dirty: false, loaded: true })
})

/** 每行 InputNumber 顺序：length, width, quantity */
const idx = (row: number, col: 'length' | 'width' | 'quantity') =>
  row * 3 + (col === 'length' ? 0 : col === 'width' ? 1 : 2)

const key = (el: Element, k: string) => fireEvent.keyDown(el, { key: k })

describe('键盘漫游（Excel 式）', () => {
  it('↓ 移动到下一行同列', async () => {
    const container = renderWorkspace()
    const inputs = container.querySelectorAll<HTMLInputElement>('.ant-input-number input')
    inputs[idx(0, 'length')]!.focus()
    key(inputs[idx(0, 'length')]!, 'ArrowDown')
    await Promise.resolve()
    expect(document.activeElement).toBe(inputs[idx(1, 'length')])
  })

  it('↑ 移动到上一行同列（首行原地）', async () => {
    const container = renderWorkspace()
    const inputs = container.querySelectorAll<HTMLInputElement>('.ant-input-number input')
    inputs[idx(1, 'width')]!.focus()
    key(inputs[idx(1, 'width')]!, 'ArrowUp')
    await Promise.resolve()
    expect(document.activeElement).toBe(inputs[idx(0, 'width')])
    // 首行继续 ↑ 不越界
    key(inputs[idx(0, 'width')]!, 'ArrowUp')
    await Promise.resolve()
    expect(document.activeElement).toBe(inputs[idx(0, 'width')])
  })

  it('→ / ← 同行左右移动列', async () => {
    const container = renderWorkspace()
    const inputs = container.querySelectorAll<HTMLInputElement>('.ant-input-number input')
    inputs[idx(0, 'length')]!.focus()
    key(inputs[idx(0, 'length')]!, 'ArrowRight')
    await Promise.resolve()
    expect(document.activeElement).toBe(inputs[idx(0, 'width')])
    key(inputs[idx(0, 'width')]!, 'ArrowLeft')
    await Promise.resolve()
    expect(document.activeElement).toBe(inputs[idx(0, 'length')])
  })

  it('方向键漫游不触发 InputNumber 步进（值不变）', async () => {
    const container = renderWorkspace()
    const inputs = container.querySelectorAll<HTMLInputElement>('.ant-input-number input')
    inputs[idx(0, 'length')]!.focus()
    key(inputs[idx(0, 'length')]!, 'ArrowUp')
    key(inputs[idx(0, 'length')]!, 'ArrowDown')
    await Promise.resolve()
    expect(useProjectStore.getState().current!.parts[0]!.length).toBe(2400)
    expect(useProjectStore.getState().current!.parts[0]!.width).toBe(400)
  })

  it('最后一行 ↓ 新增一行，焦点落新行同列', async () => {
    const container = renderWorkspace()
    const inputs = container.querySelectorAll<HTMLInputElement>('.ant-input-number input')
    const lastRow = useProjectStore.getState().current!.parts.length - 1
    inputs[idx(lastRow, 'quantity')]!.focus()
    key(inputs[idx(lastRow, 'quantity')]!, 'ArrowDown')
    await new Promise((r) => setTimeout(r, 50)) // 新增行 DOM 渲染（rAF 后）
    const parts = useProjectStore.getState().current!.parts
    expect(parts).toHaveLength(3)
    const newInputs = container.querySelectorAll<HTMLInputElement>('.ant-input-number input')
    expect(newInputs.length).toBe(3 * 3) // 3 行 × 3 个 InputNumber
    expect(document.activeElement).toBe(newInputs[idx(2, 'quantity')])
  })

  it('Enter 下移（末行不新增）', async () => {
    const container = renderWorkspace()
    const inputs = container.querySelectorAll<HTMLInputElement>('.ant-input-number input')
    inputs[idx(0, 'length')]!.focus()
    key(inputs[idx(0, 'length')]!, 'Enter')
    await Promise.resolve()
    expect(document.activeElement).toBe(inputs[idx(1, 'length')])
    // 末行 Enter 不新增
    key(inputs[idx(1, 'length')]!, 'Enter')
    await Promise.resolve()
    expect(useProjectStore.getState().current!.parts).toHaveLength(2)
  })
})
