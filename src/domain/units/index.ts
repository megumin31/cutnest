/**
 * 单位换算 —— 仅输入输出边界使用；内部一律 mm（整数）。
 * cm/in 输入边界四舍五入到 mm 整数。
 */

export type LengthUnit = 'mm' | 'cm' | 'in'

const MM_PER_CM = 10
const MM_PER_IN = 25.4

/** 任意单位 → mm 整数（四舍五入） */
export function toMm(value: number, unit: LengthUnit): number {
  if (!Number.isFinite(value)) return 0
  switch (unit) {
    case 'mm':
      return Math.round(value)
    case 'cm':
      return Math.round(value * MM_PER_CM)
    case 'in':
      return Math.round(value * MM_PER_IN)
  }
}

/** mm → 目标单位（保留 0~2 位小数，去尾零） */
export function formatLength(
  mm: number,
  unit: LengthUnit,
  precision?: number,
): string {
  let value = mm
  let decimals = 0
  switch (unit) {
    case 'mm':
      value = mm
      decimals = 0
      break
    case 'cm':
      value = mm / MM_PER_CM
      decimals = precision ?? 1
      break
    case 'in':
      value = mm / MM_PER_IN
      decimals = precision ?? 2
      break
  }
  const fixed = value.toFixed(decimals)
  // 去尾零：12.50 → 12.5
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed
}

/** 面积 mm² → 目标单位字符串（如 298 cm²） */
export function formatArea(mm2: number, unit: LengthUnit): string {
  if (unit === 'mm') return `${Math.round(mm2)} mm²`
  const factor = unit === 'cm' ? 100 : 25.4 * 25.4
  const scaled = mm2 / factor
  const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2
  return `${scaled.toFixed(decimals)} ${unit}²`
}

/** 面积 mm² → "x.xx m²"（两位小数，整数位保留；统计面板与 PDF 摘要共用） */
export function formatSqm(mm2: number): string {
  return `${Math.round((mm2 / 1e6) * 100) / 100} m²`
}
