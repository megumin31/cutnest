/**
 * units / materials 小模块单测。
 */
import { describe, it, expect } from 'vitest'
import { toMm, formatLength, formatArea } from '../src/domain/units'
import { DEFAULT_SHEETS, DEFAULT_KERF, createDefaultSettings } from '../src/domain/materials'

describe('units', () => {
  it('cm/in 四舍五入到 mm 整数', () => {
    expect(toMm(12.4, 'cm')).toBe(124)
    expect(toMm(1, 'in')).toBe(25)
    expect(toMm(2, 'in')).toBe(51)
    expect(toMm(1234, 'mm')).toBe(1234)
  })

  it('formatLength 去尾零', () => {
    expect(formatLength(2440, 'mm')).toBe('2440')
    expect(formatLength(1220, 'cm')).toBe('122')
    expect(formatLength(25, 'in')).toBe('0.98')
    expect(formatLength(254, 'in')).toBe('10')
  })

  it('formatArea 单位换算', () => {
    expect(formatArea(1_000_000, 'mm')).toBe('1000000 mm²')
    expect(formatArea(1_000_000, 'cm')).toBe('10000 cm²')
  })
})

describe('materials', () => {
  it('内置板材长 ≥ 宽', () => {
    for (const s of DEFAULT_SHEETS) expect(s.length).toBeGreaterThanOrEqual(s.width)
  })
  it('默认切缝 3mm', () => {
    expect(DEFAULT_KERF).toBe(3)
  })
  it('默认设置合理', () => {
    const s = createDefaultSettings()
    expect(s.kerf).toBe(3)
    expect(s.trimAllowance).toBe(0)
    expect(s.minReusableWaste).toBe(200)
  })
})
