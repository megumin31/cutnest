/**
 * qty 工厂单测 —— 数量整数化（截断法）：
 * 浮点数量截断为整数；非有限值/负数归 0（0 = 不参与计算的显式状态）。
 */
import { describe, it, expect } from 'vitest'
import { qty, type Quantity } from '../src/domain/types'

describe('qty 工厂（数量截断法，Part.quantity 唯一生产点）', () => {
  it('浮点数截断为整数（2.9→2、2.5→2、2.1→2）', () => {
    expect(qty(2.9)).toBe(2)
    expect(qty(2.5)).toBe(2)
    expect(qty(2.1)).toBe(2)
    expect(qty(0.9)).toBe(0)
  })

  it('小于 1 的正数归 0（0 = 不参与计算）', () => {
    expect(qty(0.4)).toBe(0)
    expect(qty(0.99)).toBe(0)
  })

  it('整数输入保持不变', () => {
    expect(qty(0)).toBe(0)
    expect(qty(1)).toBe(1)
    expect(qty(120)).toBe(120)
  })

  it('负数与非有限值归 0', () => {
    expect(qty(-3)).toBe(0)
    expect(qty(-0.5)).toBe(0)
    expect(qty(NaN)).toBe(0)
    expect(qty(Infinity)).toBe(0)
  })

  it('产物是整数 number（品牌类型运行时擦除）', () => {
    const n: Quantity = qty(7)
    expect(typeof n).toBe('number')
    expect(Number.isInteger(n)).toBe(true)
  })
})
