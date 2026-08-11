/**
 * planStore 单测 —— selectPart 选中联动翻页语义：
 * 选中当前页零件不跳页、选中他页零件跳到所在板、null 清空不跳页。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { usePlanStore, partKey } from '../src/features/cutting/planStore'
import type { CutPlan } from '../src/domain/types'
import { createDefaultSettings } from '../src/domain/materials'

const sheet = { id: 's1', name: '颗粒板', length: 2440, width: 1220, price: 98 }

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
