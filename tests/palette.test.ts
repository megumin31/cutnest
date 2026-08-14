/**
 * 色板（palette）单测 —— 锁定本轮关键行为：
 * 1) 同类零件永远同色（相邻同类不参与避撞顺移）
 * 2) 异类相邻撞色时顺移避撞（p9/p10 哈希同色 6）
 * 3) 确定性、12 色、hex 格式、无近白（与白板底可区分）
 */
import { describe, expect, it } from 'vitest'
import { PART_PALETTE, basePartColor, shadeHex, sheetPartColors } from '../src/domain/palette'

describe('PART_PALETTE', () => {
  it('12 色，全部为 #RRGGBB 格式', () => {
    expect(PART_PALETTE).toHaveLength(12)
    for (const c of PART_PALETTE) {
      expect(c).toMatch(/^#[0-9A-F]{6}$/)
    }
  })

  it('无近白：每色至少一个通道 ≤ 0xE7（带明确色调，与白板底可区分）', () => {
    for (const c of PART_PALETTE) {
      const r = parseInt(c.slice(1, 3), 16)
      const g = parseInt(c.slice(3, 5), 16)
      const b = parseInt(c.slice(5, 7), 16)
      expect(Math.min(r, g, b)).toBeLessThanOrEqual(0xe7)
    }
  })

  it('相邻色相间隔 ≥ 24°（设计 ≥27°，hex 量化容差：高亮低饱和色 RGB 舍入使色相 ±2~3°）', () => {
    const hue = (hex: string): number => {
      const r = parseInt(hex.slice(1, 3), 16) / 255
      const g = parseInt(hex.slice(3, 5), 16) / 255
      const b = parseInt(hex.slice(5, 7), 16) / 255
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const d = max - min
      if (d === 0) return 0
      let h: number
      if (max === r) h = ((g - b) / d) % 6
      else if (max === g) h = (b - r) / d + 2
      else h = (r - g) / d + 4
      return ((h * 60 + 360) % 360)
    }
    for (let i = 0; i < PART_PALETTE.length; i++) {
      const a = hue(PART_PALETTE[i])
      const b = hue(PART_PALETTE[(i + 1) % PART_PALETTE.length])
      const dist = Math.min(Math.abs(a - b), 360 - Math.abs(a - b))
      expect(dist).toBeGreaterThanOrEqual(24)
    }
  })
})

describe('shadeHex', () => {
  it('amt>0 向白偏移、amt<0 向黑偏移', () => {
    // 0.1×255 = 25.5 → 128±25.5 → round 154 / 103
    expect(shadeHex('#808080', 0.1)).toBe('#9A9A9A')
    expect(shadeHex('#808080', -0.1)).toBe('#676767')
  })

  it('结果钳制在 [0,255]，不溢出', () => {
    expect(shadeHex('#FFFFFF', 0.5)).toBe('#FFFFFF')
    expect(shadeHex('#000000', -0.5)).toBe('#000000')
    expect(shadeHex('#FF0000', 1)).toBe('#FFFFFF')
  })

  it('保持 #RRGGBB 格式', () => {
    for (const c of PART_PALETTE) {
      for (const amt of [0.045, -0.045, 0.2, -0.3]) {
        expect(shadeHex(c, amt)).toMatch(/^#[0-9A-F]{6}$/)
      }
    }
  })

  it('渐变的两个端点仍在色板附近（微渐变，不改变色相特征）', () => {
    for (const c of PART_PALETTE) {
      const light = shadeHex(c, 0.045)
      const dark = shadeHex(c, -0.045)
      expect(parseInt(light.slice(1, 3), 16)).toBeGreaterThan(parseInt(c.slice(1, 3), 16))
      expect(parseInt(dark.slice(1, 3), 16)).toBeLessThan(parseInt(c.slice(1, 3), 16))
    }
  })
})

describe('basePartColor', () => {
  it('确定性：同 id 两次结果一致', () => {
    expect(basePartColor('侧板')).toBe(basePartColor('侧板'))
  })

  it('结果恒在色板范围内', () => {
    for (const id of ['a', '侧板', 'p9', 'p10', 'drawer-face#3']) {
      const c = basePartColor(id)
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThan(PART_PALETTE.length)
    }
  })
})

describe('sheetPartColors', () => {
  it('同类零件永远同色（相邻同类不参与顺移）', () => {
    // p9 哈希 6；三个同类相邻 → 全部同色
    const ids = ['p9', 'p9', 'p9']
    const colors = sheetPartColors(ids)
    expect(colors[0]).toBe(colors[1])
    expect(colors[1]).toBe(colors[2])
  })

  it('异类相邻撞色时顺移避撞（p9 与 p10 哈希同为 6）', () => {
    const colors = sheetPartColors(['p9', 'p10'])
    expect(colors[0]).toBe(6)
    expect(colors[1]).not.toBe(6)
    expect(colors[1]).toBe(7)
  })

  it('同类同色优先级高于避撞：异类相邻撞色时顺移，不反向影响同类', () => {
    // p9 p9 p10 p9：第 3 个（p10）顺移，第 4 个（p9）回归原色
    const colors = sheetPartColors(['p9', 'p9', 'p10', 'p9'])
    expect(colors[0]).toBe(6)
    expect(colors[1]).toBe(6)
    expect(colors[2]).not.toBe(6)
    expect(colors[3]).toBe(6)
  })

  it('确定性：同输入两次结果一致', () => {
    const ids = ['p9', 'p10', '侧板', 'p9']
    expect(sheetPartColors(ids)).toEqual(sheetPartColors(ids))
  })

  it('空输入返回空数组', () => {
    expect(sheetPartColors([])).toEqual([])
  })
})
