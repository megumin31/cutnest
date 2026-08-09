/**
 * 排样结果 → 统一场景模型（零件矩形轮廓 + 标注）。
 * 场景模型与导出格式（PDF/DXF）解耦，SVG 预览也复用此模型。
 */
import type { CutPlan, SheetSpec } from '../types'

export interface ScenePart {
  partId: string
  name: string
  instance: number
  x: number
  y: number
  len: number
  wid: number
  rotated: boolean
  edgeBand?: ('L' | 'R' | 'T' | 'B')[]
}

export interface SceneSheet {
  sheetIndex: number
  /** 板材全长（未修剪） */
  length: number
  width: number
  /** 可用区域（trim/margin 后） */
  usableLen: number
  usableWid: number
  parts: ScenePart[]
  /** 已用面积 mm² */
  usedArea: number
  /** 利用率 % */
  utilization: number
}

export function toScene(plan: CutPlan, sheetLibrary: SheetSpec[], partNames: Map<string, string>): SceneSheet[] {
  const specById = new Map(sheetLibrary.map((s) => [s.id, s]))
  const border = plan.settings.trimAllowance
  return plan.sheets.map((layout) => {
    const spec = specById.get(layout.sheetSpecId) ?? sheetLibrary[0]
    const usableLen = spec.length - 2 * border
    const usableWid = spec.width - 2 * border
    let usedArea = 0
    const parts: ScenePart[] = layout.placements.map((p) => {
      usedArea += p.len * p.wid
      return {
        partId: p.partId,
        name: partNames.get(p.partId) ?? p.partId,
        instance: p.instance,
        x: p.x,
        y: p.y,
        len: p.len,
        wid: p.wid,
        rotated: p.rotated,
        edgeBand: undefined,
      }
    })
    const usableArea = usableLen * usableWid
    return {
      sheetIndex: layout.sheetIndex,
      length: spec.length,
      width: spec.width,
      usableLen,
      usableWid,
      parts,
      usedArea,
      utilization: usableArea > 0 ? (usedArea / usableArea) * 100 : 0,
    }
  })
}
