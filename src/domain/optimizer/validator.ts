/**
 * 方案校验器 —— 任何方案必须过校验才允许输出（架构文档 §4 规则 6）。
 * 校验项：零件完整性 / 越界 / 相互重叠与切缝不足 / 旋转约束 / 尺寸一致性。
 */
import { EPSILON, type CutPlan, type Placement, type SheetLayout } from '../types'
import type { Part, SheetSpec, OptimizeSettings } from '../types'

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

/** 零件实例展开表：partId → 实例编号集合 */
function expandInstanceSets(parts: Part[]): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>()
  for (const p of parts) {
    const set = new Set<number>()
    for (let i = 0; i < p.quantity; i++) set.add(i)
    map.set(p.id, set)
  }
  return map
}

function usableDims(sheet: SheetSpec, settings: OptimizeSettings): { len: number; wid: number } {
  const trim = settings.trimAllowance
  return {
    len: sheet.length - 2 * trim,
    wid: sheet.width - 2 * trim,
  }
}

/** 两矩形在真实空间的最小间距（轴向重叠为负） */
function gapX(a: Placement, b: Placement): number {
  return Math.max(a.x, b.x) - Math.min(a.x + a.len, b.x + b.len)
}
function gapY(a: Placement, b: Placement): number {
  return Math.max(a.y, b.y) - Math.min(a.y + a.wid, b.y + b.wid)
}

export function validatePlan(
  plan: CutPlan,
  parts: Part[],
  sheets: SheetSpec[],
  settings: OptimizeSettings,
): ValidationResult {
  const errors: string[] = []
  const instances = expandInstanceSets(parts)
  const byId = new Map(parts.map((p) => [p.id, p]))
  const specById = new Map(sheets.map((s) => [s.id, s]))

  for (const layout of plan.sheets) {
    // 板材规格：布局引用的规格必须在板材库中
    const spec = specById.get(layout.sheetSpecId)
    if (!spec) {
      errors.push(`第 ${layout.sheetIndex + 1} 张板规格 ${layout.sheetSpecId} 不在板材库中`)
      continue
    }
    const { len: usableLen, wid: usableWid } = usableDims(spec, settings)
    const seenInSheet = new Set<string>()
    for (const pl of layout.placements) {
      const key = `${pl.partId}#${pl.instance}`
      if (seenInSheet.has(key)) {
        errors.push(`零件 ${key} 在同一张板重复出现`)
        continue
      }
      seenInSheet.add(key)
      const part = byId.get(pl.partId)
      if (!part) {
        errors.push(`零件 ${pl.partId} 不存在于输入`)
        continue
      }
      const instSet = instances.get(pl.partId)
      if (!instSet || !instSet.has(pl.instance)) {
        errors.push(`零件 ${key} 超出数量范围`)
        continue
      }
      instSet.delete(pl.instance)

      // 指定板材约束：指定了 sheetId 的零件必须在其指定规格的板上
      if (part.sheetId && layout.sheetSpecId !== part.sheetId) {
        errors.push(`零件 ${key} 指定板材 ${part.sheetId}，却在规格 ${layout.sheetSpecId} 的板上`)
      }

      // 尺寸一致性
      const expectLen = pl.rotated ? part.width : part.length
      const expectWid = pl.rotated ? part.length : part.width
      if (Math.abs(pl.len - expectLen) > EPSILON || Math.abs(pl.wid - expectWid) > EPSILON) {
        errors.push(`零件 ${key} 尺寸与输入不符`)
      }

      // 旋转约束
      if (pl.rotated && part.grain !== 'any') {
        errors.push(`零件 ${key} 违反旋转约束`)
      }

      // 越界（含 trim 后的可用区域）
      if (pl.x < -EPSILON || pl.y < -EPSILON || pl.x + pl.len > usableLen + EPSILON || pl.y + pl.wid > usableWid + EPSILON) {
        errors.push(`零件 ${key} 越出可用区域`)
      }
    }
  }

  // 完整性：输入中每个零件实例都必须出现
  for (const [partId, set] of instances) {
    if (set.size > 0) {
      errors.push(`零件 ${partId} 缺少 ${set.size} 个实例未排入`)
    }
  }

  // 两两检查切缝（同一张板内）
  const kerf = settings.kerf
  for (const layout of plan.sheets) {
    const ps = layout.placements
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const gx = gapX(ps[i], ps[j])
        const gy = gapY(ps[i], ps[j])
        // 两矩形膨胀 kerf/2 后重叠 → 净距不足
        if (gx < kerf - EPSILON && gy < kerf - EPSILON) {
          errors.push(
            `零件 ${ps[i].partId}#${ps[i].instance} 与 ${ps[j].partId}#${ps[j].instance} 净距不足 kerf=${kerf}`,
          )
        }
      }
    }
  }

  return { ok: errors.length === 0, errors }
}

export type { SheetLayout }
