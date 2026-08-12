/**
 * 排样快照 → 零件表重建 —— 旧版历史记录无 parts 快照时的兜底：
 * 从 plan.sheets.placements 按 partId 聚合实例数量，旋转实例还原未旋转尺寸。
 * 仅可恢复尺寸/数量/名字；grain/sheetId/edgeBand 无排样时快照信息，取安全默认。
 */
import type { CutPlan, Part } from '../../domain/types'
import { qty } from '../../domain/types'

export function rebuildPartsFromPlan(plan: CutPlan, partNames: Record<string, string> | null): Part[] {
  const byId = new Map<string, { length: number; width: number; quantity: number }>()
  for (const sheet of plan.sheets) {
    for (const p of sheet.placements) {
      // 排布尺寸可能已旋转：rotated 时未旋转 length=wid、width=len
      const length = p.rotated ? p.wid : p.len
      const width = p.rotated ? p.len : p.wid
      const cur = byId.get(p.partId)
      if (cur) {
        cur.quantity++
        // 同名零件出现不同尺寸（数据异常）：以首见为准，不混尺寸
        if (cur.length !== length || cur.width !== width) {
          cur.length = Math.max(cur.length, length)
          cur.width = Math.max(cur.width, width)
        }
      } else {
        byId.set(p.partId, { length, width, quantity: qty(1) })
      }
    }
  }
  return [...byId.entries()].map(([id, v]) => ({
    id,
    name: partNames?.[id] ?? id,
    length: v.length,
    width: v.width,
    quantity: qty(v.quantity),
    grain: 'alongLength' as const,
  }))
}
