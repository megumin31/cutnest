/**
 * 字典序评价 —— 产品价值观，唯一且不可配置（架构文档 §6.2）：
 * ① 用板张数最少  ② 同类聚排（同 partId 零件共享边总长最大，同尺寸零件整排聚块、不散落）
 * ③ 余料最集中（可再利用块数越少越好、最大块越大越好）。
 * 碎料（< minReusableWaste）算废料，不计入可再利用块。
 *
 * 同类聚排判定：同 partId 的实例**真实紧贴**（槽空间间距为 0，即真实间隔 = kerf）时
 * 共享完整边（同层并排共享竖边 / 上下叠放共享横边），共享长度按真实尺寸计算，
 * 共享边总长越大 = 同类贴得越紧。隔着其他零件的同类件不算共享边（旧实现误计 → 聚排层失效）。
 * 该层驱动"零件按种类聚成整排/整块"的布局整齐度（用户诉求，见 v1.0 评审）。
 *
 * 可再利用判定：槽空间自由区域 = skyline 上方矩形条（条带分解）+ 悬空洞
 * （skyline 悬空放置产生的真实废料区域，旧实现吞洞 → 余料集中度虚高 + 切割图白块）。
 * 相邻条带 x 相邻即连通（共享顶部），合并为区域后，
 * 区域内存在连续条带子段：总宽 ≥ s 且全部条带高 ≥ s（即能容纳 s×s 方块）→ 可再利用。
 * 这条判定避免了"31×1223 窄条 + 顶部薄层"这类 L 形被外接框误判。
 */
import { EPSILON } from '../types'
import type { HoleRect, PackItem, PackResult, PackedSheet } from './stripPacker'

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

/**
 * 悬空洞区域：洞矩形按 x 相邻合并成区域（洞顶被放置零件槽封住，与 skyline 上方条带
 * 至多角接触、永不相通——独立成区域，不参与条带合并）。
 */
function holeRegions(holes: HoleRect[]): WasteRegion[] {
  const sorted = [...holes].sort((a, b) => a.x - b.x || a.y - b.y)
  const regions: WasteRegion[] = []
  let cur: WasteRegion | null = null
  for (const h of sorted) {
    if (cur && Math.abs(cur.strips[cur.strips.length - 1].x + cur.strips[cur.strips.length - 1].w - h.x) <= EPSILON) {
      cur.strips.push({ x: h.x, y: h.y, w: h.w, h: h.h })
      cur.area += h.w * h.h
      cur.bounds.w = h.x + h.w - cur.bounds.x
      cur.bounds.h = Math.max(cur.bounds.h, h.h)
    } else {
      if (cur) regions.push(cur)
      cur = { strips: [{ x: h.x, y: h.y, w: h.w, h: h.h }], area: h.w * h.h, bounds: { x: h.x, y: h.y, w: h.w, h: h.h } }
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
}

/**
 * 同类聚排：同 partId 且**真实紧贴**（槽空间间距为 0，即真实间隔 = kerf）的实例共享边，
 * 共享长度按真实尺寸（不含 kerf）计算。
 * 修正说明：旧实现用 yOverlap <= EPSILON 判定，把"投影不重叠但中间隔着其他零件"的同类件
 * 也当作共享边（假共享高估），导致交替插排的同类件得分虚高、与真聚排打平——聚排层失效。
 */
function contactLength(a: { item: PackItem; x: number; y: number }, b: { item: PackItem; x: number; y: number }): number {
  const aR = a.x + a.item.slotLen
  const bR = b.x + b.item.slotLen
  const aT = a.y + a.item.slotWid
  const bT = b.y + b.item.slotWid
  // 真实尺寸（不含 kerf 走廊）投影重叠长度
  const xReal = Math.min(a.x + a.item.len, b.x + b.item.len) - Math.max(a.x, b.x)
  const yReal = Math.min(a.y + a.item.wid, b.y + b.item.wid) - Math.max(a.y, b.y)
  if (Math.abs(aT - b.y) <= EPSILON && xReal > EPSILON) return xReal // a 紧贴 b 下方（共享横边）
  if (Math.abs(bT - a.y) <= EPSILON && xReal > EPSILON) return xReal // b 紧贴 a 下方
  if (Math.abs(aR - b.x) <= EPSILON && yReal > EPSILON) return yReal // a 紧贴 b 左侧（共享竖边）
  if (Math.abs(bR - a.x) <= EPSILON && yReal > EPSILON) return yReal // b 紧贴 a 左侧
  return 0
}

/**
 * 计算方案的字典序评价。
 * 余料区域 = skyline 上方条带 + 悬空洞（真实存在的废料，旧实现吞洞导致余料集中度虚高）。
 */
export function evaluatePlan(result: PackResult, minReusableWaste: number): EvalScore {
  const sheetCount = result.sheets.length
  let contact = 0
  let blocks = 0
  let largest = 0
  for (const sheet of result.sheets) {
    // 同类聚排：同 partId 且真实紧贴（共享完整边）的实例
    const ps = sheet.placements
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i]
        const b = ps[j]
        if (a.item.partId !== b.item.partId) continue
        contact += contactLength(a, b)
      }
    }
    const regions = [...regionStrips(sheet), ...holeRegions(sheet.holes)]
    for (const region of regions) {
      if (containsSquare(region, minReusableWaste)) {
        blocks++
        if (region.area > largest) largest = region.area
      }
    }
  }
  // 同类接触总长越大越好 → 取负进入"越小越好"的字典序
  const negContact = -contact
  return { sheetCount, compactness: negContact, reusableWasteBlocks: blocks, largestReusableWaste: largest }
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
  const holes: HoleRect[] = []
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
    // 悬空洞：覆盖范围内低于放置底 y 的 skyline 段（与 packer 的 placeOnSkyline 同判定，
    // 保证可视化与排样模型一致——洞是真实废料，必须画成余料而非白色空隙）
    for (let k = start; k <= end; k++) {
      const seg = skyline[k]
      if (seg.y < y - EPSILON) {
        const hx = Math.max(seg.x, x)
        const hx2 = Math.min(seg.x + seg.w, x + w)
        if (hx2 - hx > EPSILON) {
          holes.push({ x: hx, y: seg.y, w: hx2 - hx, h: y - seg.y })
        }
      }
    }
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
  const sheet: PackedSheet = { sheetSpecId: '', placements: [], skyline, holes, slotLen, slotWid }
  const regions = [...regionStrips(sheet), ...holeRegions(holes)]
  // 槽空间 → 真实空间：条带底 = 槽顶 - kerf（= 该处零件真实顶）；
  // 顶部保持到槽顶 slotWid，渲染时由 viewBox 裁剪（slotWid - usableWid = kerf），不产生白缝；
  // 洞条带同理（底 = 洞底槽坐标 - kerf，顶 = 放置底 - kerf = 零件真实底）
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
