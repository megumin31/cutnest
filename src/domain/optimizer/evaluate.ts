/**
 * 字典序评价 —— 产品价值观，唯一且不可配置（架构文档 §6.2）：
 * ① 用板张数最少  ② 同类聚排（同 partId 零件共享边总长最大，同尺寸零件整排聚块、不散落）
 * ③ 余料最集中（可再利用块数越少越好、最大块越大越好）。
 * 碎料（< minReusableWaste）算废料，不计入可再利用块。
 *
 * 同类聚排判定：skyline 排样中，同 partId 的实例相邻放置时共享完整边
 * （同层并排共享竖边 / 上下叠放共享横边），共享边总长越大 = 同类贴得越紧。
 * 该层驱动"零件按种类聚成整排/整块"的布局整齐度（用户诉求，见 v1.0 评审）。
 *
 * 可再利用判定：槽空间自由区域 = skyline 上方矩形条（条带分解）。
 * 相邻条带 x 相邻即连通（共享顶部），合并为区域后，
 * 区域内存在连续条带子段：总宽 ≥ s 且全部条带高 ≥ s（即能容纳 s×s 方块）→ 可再利用。
 * 这条判定避免了"31×1223 窄条 + 顶部薄层"这类 L 形被外接框误判。
 */
import { EPSILON } from '../types'
import type { PackResult, PackedSheet } from './stripPacker'

/** 单条带（自由矩形）：x 起点、y 底部、宽、高 */
export interface Strip {
  x: number
  y: number
  w: number
  h: number
}

/** 一个连通自由区域 = 若干 x 相邻条带（条带顶都到槽顶 slotWid） */
export interface WasteRegion {
  strips: Strip[]
  /** 真实并集面积（不含切缝走廊） */
  area: number
  /** 外接框（可视化用） */
  bounds: { x: number; y: number; w: number; h: number }
}

/** 区域条带分解（按 skyline 段，h > 0 的非空条带） */
function regionStrips(sheet: PackedSheet): WasteRegion[] {
  const regions: WasteRegion[] = []
  let cur: WasteRegion | null = null
  for (const seg of sheet.skyline) {
    const h = sheet.slotWid - seg.y
    if (h <= EPSILON) {
      cur = null
      continue
    }
    if (cur && Math.abs(cur.strips[cur.strips.length - 1].x + cur.strips[cur.strips.length - 1].w - seg.x) <= EPSILON) {
      cur.strips.push({ x: seg.x, y: sheet.slotWid - h, w: seg.w, h })
      cur.area += seg.w * h
      cur.bounds.w = cur.strips[cur.strips.length - 1].x + cur.strips[cur.strips.length - 1].w - cur.bounds.x
      cur.bounds.h = Math.max(cur.bounds.h, h)
      cur.bounds.y = sheet.slotWid - cur.bounds.h
    } else {
      if (cur) regions.push(cur)
      cur = { strips: [{ x: seg.x, y: sheet.slotWid - h, w: seg.w, h }], area: seg.w * h, bounds: { x: seg.x, y: sheet.slotWid - h, w: seg.w, h } }
    }
  }
  if (cur) regions.push(cur)
  return regions
}

/** 区域内能否容纳 s×s 方块（连续条带子段宽度 ≥ s 且段内全部高度 ≥ s） */
function containsSquare(region: WasteRegion, side: number): boolean {
  const strips = region.strips
  const n = strips.length
  for (let i = 0; i < n; i++) {
    if (strips[i].h < side - EPSILON) continue
    let width = 0
    for (let j = i; j < n; j++) {
      if (strips[j].h < side - EPSILON) break
      width += strips[j].w
      if (width >= side - EPSILON) return true
    }
  }
  return false
}

export interface EvalScore {
  /** 用板张数（首要） */
  sheetCount: number
  /** 同类聚排：同 partId 零件共享边总长取负（共享边越长 = 贴得越紧 = 负值越小） */
  compactness: number
  /** 可再利用余料块数（再次，越少越好） */
  reusableWasteBlocks: number
  /** 最大可再利用余料块面积 mm²（再次，越大越好） */
  largestReusableWaste: number
  /**
   * 单调标量成本（字典序保序，仅参考/兼容保留）——
   * SA 接受判定已改为字典序分层（search.ts）：板数层硬规则 + 紧凑度层毫米温度退火，
   * 不再使用本标量（固定权重 × 无界量的编码在大项目上会与张数层同量级碰撞）。
   */
  cost: number
}

/**
 * 计算方案的字典序评价。
 */
export function evaluatePlan(result: PackResult, minReusableWaste: number): EvalScore {
  const sheetCount = result.sheets.length
  let contact = 0
  let blocks = 0
  let largest = 0
  for (const sheet of result.sheets) {
    // 同类聚排：同 partId 且相邻（共享完整边）的实例
    const ps = sheet.placements
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i]
        const b = ps[j]
        if (a.item.partId !== b.item.partId) continue
        const xOverlap = Math.min(a.x + a.item.slotLen, b.x + b.item.slotLen) - Math.max(a.x, b.x)
        const yOverlap = Math.min(a.y + a.item.slotWid, b.y + b.item.slotWid) - Math.max(a.y, b.y)
        if (xOverlap > EPSILON && yOverlap <= EPSILON) contact += xOverlap
        else if (yOverlap > EPSILON && xOverlap <= EPSILON) contact += yOverlap
      }
    }
    for (const region of regionStrips(sheet)) {
      if (containsSquare(region, minReusableWaste)) {
        blocks++
        if (region.area > largest) largest = region.area
      }
    }
  }
  // 同类接触总长越大越好 → 取负进入"越小越好"的字典序
  const negContact = -contact
  // 字典序严格保序：张数 1e18 > 同类聚排 1e12 > 块数 1e12 > 最大块面积 (<1e9)
  // 注：SA 接受判定已改为分层（见 search.ts），本标量仅参考/兼容保留，不再参与退火
  const cost = sheetCount * 1e18 + negContact * 1e12 + blocks * 1e12 - largest
  return { sheetCount, compactness: negContact, reusableWasteBlocks: blocks, largestReusableWaste: largest, cost }
}

/** 字典序比较：a 优于 b 返回 >0 */
export function compareScores(a: EvalScore, b: EvalScore): number {
  if (a.sheetCount !== b.sheetCount) return b.sheetCount - a.sheetCount
  if (a.compactness !== b.compactness) return b.compactness - a.compactness
  if (a.reusableWasteBlocks !== b.reusableWasteBlocks) return b.reusableWasteBlocks - a.reusableWasteBlocks
  return a.largestReusableWaste - b.largestReusableWaste
}

/**
 * 从排样结果重建各板 skyline 并导出余料区域（可视化用）。
 * placements 顺序 = 排样顺序（CutPlan 保证）。
 */
export function wasteRegionsOfLayout(
  placements: { x: number; y: number; len: number; wid: number }[],
  usableLen: number,
  usableWid: number,
  kerf: number,
): WasteRegion[] {
  const slotLen = usableLen + kerf
  const slotWid = usableWid + kerf
  let skyline: { x: number; y: number; w: number }[] = [{ x: 0, y: 0, w: slotLen }]
  for (const pl of placements) {
    const w = pl.len + kerf
    const h = pl.wid + kerf
    const x = pl.x
    const y = pl.y
    // 找到覆盖 [x, x+w] 的段
    let start = -1
    let end = -1
    for (let i = 0; i < skyline.length; i++) {
      if (skyline[i].x + skyline[i].w > x + EPSILON) {
        start = i
        break
      }
    }
    for (let j = skyline.length - 1; j >= 0; j--) {
      if (skyline[j].x < x + w - EPSILON) {
        end = j
        break
      }
    }
    if (start === -1 || end === -1) continue
    const newSegs: { x: number; y: number; w: number }[] = []
    for (let k = 0; k < start; k++) newSegs.push(skyline[k])
    const leftCover = x - skyline[start].x
    if (leftCover > EPSILON) newSegs.push({ x: skyline[start].x, y: skyline[start].y, w: leftCover })
    newSegs.push({ x, y: y + h, w })
    const rightEnd = skyline[end].x + skyline[end].w
    const rightCover = rightEnd - (x + w)
    if (rightCover > EPSILON) newSegs.push({ x: x + w, y: skyline[end].y, w: rightCover })
    for (let k = end + 1; k < skyline.length; k++) newSegs.push(skyline[k])
    const merged: { x: number; y: number; w: number }[] = []
    for (const s of newSegs) {
      const last = merged[merged.length - 1]
      if (last && Math.abs(last.y - s.y) <= EPSILON && Math.abs(last.x + last.w - s.x) <= EPSILON) {
        last.w += s.w
      } else {
        merged.push({ ...s })
      }
    }
    skyline = merged
  }
  const sheet: PackedSheet = { sheetSpecId: '', placements: [], skyline, slotLen, slotWid }
  const regions = regionStrips(sheet)
  // 槽空间 → 真实空间：条带底 = 槽顶 - kerf（= 该处零件真实顶）；
  // 顶部保持到槽顶 slotWid，渲染时由 viewBox 裁剪（slotWid - usableWid = kerf），不产生白缝
  const real: WasteRegion[] = []
  for (const r of regions) {
    const strips = r.strips.map((s) => ({ ...s, y: s.y - kerf }))
    const xs = strips.map((s) => s.x)
    const x2s = strips.map((s) => s.x + s.w)
    const ys = strips.map((s) => s.y)
    real.push({
      strips,
      area: r.area,
      bounds: {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...x2s) - Math.min(...xs),
        h: Math.max(...strips.map((s) => s.y + s.h)) - Math.min(...ys),
      },
    })
  }
  return real
}
