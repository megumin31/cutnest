/**
 * 数量列输入行为组件级回归（jsdom 真实渲染 antd InputNumber）——
 * 回归点：antd 的 precision 会在失焦时对输入值四舍五入（2.5→3），
 * 与截断法（qty: 2.5→2）冲突；本测试锁定"输入 2.5/2.9 → store 收到 2"的完整链路
 * （InputNumber 配置 + onChange → patch → qty 截断），防止未来重新引入 precision 或改回四舍五入。
 */
// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { describe, expect, it, beforeEach } from 'vitest'
import { render, fireEvent, within } from '@testing-library/react'
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
    id: 'proj-q',
    name: '数量测试',
    parts: [{ id: 'p1', name: '侧板', length: 1000, width: 500, quantity: qty(1) }],
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

/** 输入并失焦（失焦触发 antd 的 precision 格式化路径），返回 store 中 quantity 实际值 */
async function typeQuantity(value: string): Promise<number> {
  const { container } = render(
    <ConfigProvider>
      <AntApp>
        <PartsWorkspace />
      </AntApp>
    </ConfigProvider>,
  )
  // 第一行：长/宽/数量三个 InputNumber（.ant-input-number input，避开工具行隐藏 file input）——数量是第 3 个
  const inputs = container.querySelectorAll('.ant-input-number input')
  const qtyInput = inputs[2] as HTMLInputElement
  fireEvent.change(qtyInput, { target: { value } })
  fireEvent.blur(qtyInput)
  await Promise.resolve()
  return useProjectStore.getState().current!.parts[0]!.quantity
}

beforeEach(async () => {
  initI18n('zh')
  usePlanStore.setState({ inputFingerprint: null, plan: null, status: 'idle' })
  useProjectStore.setState({ current: makeProject(), projects: [], dirty: false, loaded: true })
})

describe('数量列输入（截断法，非四舍五入）', () => {
  it('输入 2.5 → 截断为 2', async () => {
    expect(await typeQuantity('2.5')).toBe(2)
  })

  it('输入 2.9 → 截断为 2（四舍五入会得 3，回归点）', async () => {
    expect(await typeQuantity('2.9')).toBe(2)
  })

  it('输入 0.4 → 截断为 0', async () => {
    expect(await typeQuantity('0.4')).toBe(0)
  })

  it('输入整数 7 保持不变', async () => {
    expect(await typeQuantity('7')).toBe(7)
  })

  it('批量粘贴小数数量截断（2.9→2、0.4→0），行不再被丢弃', async () => {
    const { container } = render(
      <ConfigProvider>
        <AntApp>
          <PartsWorkspace />
        </AntApp>
      </ConfigProvider>,
    )
    fireEvent.click(within(container).getByText('批量粘贴'))
    const modal = [...document.querySelectorAll('.ant-modal')].at(-1) as HTMLElement
    const textarea = within(modal).getByPlaceholderText(/每行一个零件/) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '甲 100 50 2.9\n乙 100 50 0.4\n丙 100 50 0' } })
    fireEvent.click(within(modal).getByRole('button', { name: /导\s*入/ }))
    await Promise.resolve()
    const parts = useProjectStore.getState().current!.parts
    expect(parts).toHaveLength(4) // 原有 1 件 + 3 行全部保留（0 为显式不参与状态）
    expect(parts.map((p) => p.quantity)).toEqual([1, 2, 0, 0])
  })
})
