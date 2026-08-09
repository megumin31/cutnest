/**
 * DXF 导出 —— 给机器执行：毫米单位、闭合轮廓、按切割顺序组织、
 * 空行程优化（最近邻 + 2-opt）、轮廓统一方向（顺铣默认）、首刀在角上。
 * 图层名/标注仅用 ASCII（行业惯例，机器不认中文）。
 */
import Drawing from 'dxf-writer'
import type { CutPlan, SheetSpec, ExportPrefs } from '../types'
import { toScene, type ScenePart } from './toScene'

/** 图层名 ASCII 化：保留 [A-Za-z0-9_-]，其余替换为 _；空则用 partId */
export function asciiLayerName(name: string, partId: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
  return cleaned.length > 0 ? cleaned : partId
}

/** 矩形轮廓顶点（从角上起刀）。climb=顺铣 → 顺时针；conventional=逆铣 → 逆时针 */
export function rectContour(p: ScenePart, direction: 'climb' | 'conventional'): [number, number][] {
  const x = p.x
  const y = p.y
  const x2 = p.x + p.len
  const y2 = p.y + p.wid
  if (direction === 'climb') {
    return [
      [x, y],
      [x2, y],
      [x2, y2],
      [x, y2],
    ]
  }
  return [
    [x, y],
    [x, y2],
    [x2, y2],
    [x2, y],
  ]
}

function dist(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

/** 切割顺序优化：最近邻起手 → 2-opt 局部改进（空行程减少 20~40%）。返回重排后的索引顺序。 */
export function optimizeCutOrder(starts: [number, number][]): number[] {
  const n = starts.length
  if (n <= 2) return starts.map((_, i) => i)
  // 最近邻
  const order: number[] = [0]
  const used = new Set([0])
  let cur = 0
  while (order.length < n) {
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < n; i++) {
      if (used.has(i)) continue
      const d = dist(starts[cur], starts[i])
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    used.add(best)
    order.push(best)
    cur = best
  }
  // 2-opt 改进（开放旅程；最多 50 轮）
  let improved = true
  let rounds = 0
  while (improved && rounds < 50) {
    improved = false
    rounds++
    for (let i = 0; i < n - 2; i++) {
      for (let j = i + 2; j < n; j++) {
        const a = starts[order[i]]
        const b = starts[order[i + 1]]
        const c = starts[order[j]]
        const before = dist(a, b) + (j < n - 1 ? dist(c, starts[order[j + 1]]) : 0)
        const after = dist(a, c) + (j < n - 1 ? dist(b, starts[order[j + 1]]) : 0)
        if (after + 1e-9 < before) {
          const seg = order.slice(i + 1, j + 1).reverse()
          order.splice(i + 1, j - i, ...seg)
          improved = true
        }
      }
    }
  }
  return order
}

/** 生成 DXF 文本（含全部板材，板间纵向留空 100mm）。 */
export function renderDXF(
  plan: CutPlan,
  sheetLibrary: SheetSpec[],
  prefs: ExportPrefs,
  partNames: Map<string, string>,
): string {
  const scene = toScene(plan, sheetLibrary, partNames)
  const d = new Drawing()
  d.setUnits('Millimeters')

  const gap = 100
  // 每板按自身宽度累加偏移（多规格板宽不同）
  let acc = 0
  const yOf = new Map<number, number>()
  for (const sc of scene) {
    yOf.set(sc.sheetIndex, acc)
    acc += sc.width + gap
  }
  const yOffset = (sheetIdx: number) => yOf.get(sheetIdx) ?? 0
  // 排样坐标相对可用区原点；trim/留边后必须平移到物理板绝对坐标
  const border = plan.settings.trimAllowance

  // 每类零件一个图层
  const layerByPart = new Map<string, string>()
  const usedLayerNames = new Set<string>()
  let colorIdx = 0
  const allParts: { part: ScenePart; sheetIdx: number; layer: string }[] = []
  for (const sc of scene) {
    for (const p of sc.parts) {
      if (!layerByPart.has(p.partId)) {
        // ASCII 名已被其他零件占用时用 partId 兜底（dxf-writer 同名 addLayer 会静默覆盖）
        const base = asciiLayerName(p.name, p.partId)
        const layer = usedLayerNames.has(base) ? p.partId : base
        usedLayerNames.add(layer)
        d.addLayer(layer, (colorIdx % 6) + 1, 'CONTINUOUS')
        colorIdx++
        layerByPart.set(p.partId, layer)
      }
      allParts.push({ part: p, sheetIdx: sc.sheetIndex, layer: layerByPart.get(p.partId)! })
    }
  }

  // 切割顺序：以各零件起刀角（左下角）为节点做最近邻 + 2-opt
  const starts: [number, number][] = allParts.map(({ part, sheetIdx }) => [
    part.x + border,
    part.y + border + yOffset(sheetIdx),
  ])
  const order = optimizeCutOrder(starts)

  for (const idx of order) {
    const { part, sheetIdx, layer } = allParts[idx]
    d.setActiveLayer(layer)
    const dy = yOffset(sheetIdx)
    const contour = rectContour(part, prefs.dxf.cutDirection).map(([x, y]) => [
      x + border,
      y + border + dy,
    ]) as [number, number][]
    d.drawPolyline(contour, true)
    // 英文标注：零件名 + 尺寸，位于零件中心
    d.drawText(
      part.x + border + part.len / 2,
      part.y + border + part.wid / 2 + dy,
      50,
      0,
      `${asciiLayerName(part.name, part.partId)} ${Math.round(part.len)}x${Math.round(part.wid)}`,
      'center',
      'middle',
    )
  }

  return d.toDxfString()
}
