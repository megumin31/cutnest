/**
 * 排样结果 → 统一场景模型（零件矩形轮廓 + 标注）。
 * 场景模型与导出格式（PDF/DXF）解耦，SVG 预览也复用此模型。
 * 板材尺寸一律取 plan.sheetLibrary（排样快照）：导出必须与排样时一致，不允许静默兜底。
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
  /** 可用区域（trim 修边后） */
  usableLen: number
  usableWid: number
  parts: ScenePart[]
  /** 已用面积 mm² */
  usedArea: number
  /** 利用率 % */
  utilization: number
}

export function toScene(
  plan: CutPlan,
  sheetLibrary: SheetSpec[],
  partNames: Map<string, string>,
  edgeBands?: Map<string, ('L' | 'R' | 'T' | 'B')[]>,
): SceneSheet[] {
  const specById = new Map(sheetLibrary.map((s) => [s.id, s]))
  const trim = plan.settings.trimAllowance
  return plan.sheets.map((layout) => {
    const spec = specById.get(layout.sheetSpecId)
    if (!spec) {
      throw new Error(`板材规格 ${layout.sheetSpecId} 不在排样板材库中（快照与板材库不一致，不能导出）`)
    }
    const usableLen = spec.length - 2 * trim
    const usableWid = spec.width - 2 * trim
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
        edgeBand: edgeBands?.get(p.partId),
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
