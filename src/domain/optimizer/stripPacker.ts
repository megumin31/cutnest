/**
 * skyline 排样 —— 按给定顺序逐块堆叠，零件向板材一端（左下）挤。
 * 多板全局最低位置：每个零件放入所有板中"可用位置 y 最低"的那张（同 y 取最左），
 * 全部板都放不下才开新板 —— 让后到的填料零件能填进旧板的侧洞。
 *
 * 切缝处理：零件在"槽空间"中占 (len+kerf)×(wid+kerf)，板材槽空间 = (len+kerf)×(wid+kerf)，
 * 等价于零件间净距恒为 kerf、板边无间距（边缘预留由 trimAllowance 表达）。
 *
 * 命名约定：实体规格（零件/板材/槽空间/可用区）一律用 len/wid（长度×宽度，方向标签，不保证 len ≥ wid）；
 * 纯几何矩形（skyline 条带段、余料条带、外接框、bestFit 的待放矩形参数）用 w/h
 * （坐标尺寸，无姿态，x↔w、y↔h）。两者语义不同，勿强行统一。
 */
import { EPSILON } from '../types'

/** 已展开的待排实例（方向已定） */
export interface PackItem {
  partId: string
  instance: number
  /** 槽空间长（已含 kerf） */
  slotLen: number
  /** 槽空间宽（已含 kerf） */
  slotWid: number
  /** 实际占用的零件长（槽长 - kerf） */
  len: number
  wid: number
  rotated: boolean
  /** 是否允许旋转（grain==='any'）；缺省 false = 禁止旋转，packer 不尝试旋转 fallback */
  rotatable?: boolean
  /** 指定板材规格 id（板材库中）；缺省 = 任意规格均可 */
  sheetId?: string
}

/** 板材库条目（可用区，trim 已扣除） */
export interface SheetLibraryEntry {
  id: string
  /** 可用区长度（X 轴，长度方向） */
  usableLen: number
  /** 可用区宽度（Y 轴，宽度方向） */
  usableWid: number
}

export interface SkylineSeg {
  x: number
  y: number
  w: number
}

export interface PackedSheet {
  /** 该板使用的板材规格 id */
  sheetSpecId: string
  /** 槽空间坐标的放置（x/y 即零件左下角真实坐标） */
  placements: { item: PackItem; x: number; y: number }[]
  skyline: SkylineSeg[]
  /** 槽空间长（X 方向，含 kerf） */
  slotLen: number
  /** 槽空间宽（Y 方向，含 kerf） */
  slotWid: number
}

export interface PackResult {
  sheets: PackedSheet[]
}

interface Fit {
  sheetIdx: number
  y: number
  x: number
  start: number
  end: number
}

/** 单张板 skyline 上的最佳位置（最低 y，同 y 最左）；返回 null 表示放不下 */
function bestFit(
  segs: SkylineSeg[],
  w: number,
  h: number,
  slotWid: number,
  maxDepth: number,
): Fit | null {
  // 深度过滤：板内最深的空位都不够高 → 直接放不下
  if (maxDepth + h > slotWid + EPSILON) return null
  let bestY = Number.POSITIVE_INFINITY
  let bestX = Number.POSITIVE_INFINITY
  let bestStart = -1
  let bestEnd = -1
  const n = segs.length
  for (let i = 0; i < n; i++) {
    // 左邻严格更低 → 从 i-1 起步必不差（同高更靠左），跳过
    if (i > 0 && segs[i - 1].y < segs[i].y - EPSILON) continue
    let y = segs[i].y
    let width = 0
    let j = i
    for (; j < n; j++) {
      if (segs[j].y > y) y = segs[j].y
      width += segs[j].w
      if (width >= w - EPSILON) break
    }
    if (width < w - EPSILON) break // 剩余宽度不足，后续起点更不可能
    if (y + h > slotWid + EPSILON) continue // 超顶，试试更靠右的坑
    if (y < bestY - EPSILON || (Math.abs(y - bestY) <= EPSILON && segs[i].x < bestX)) {
      bestY = y
      bestX = segs[i].x
      bestStart = i
      bestEnd = j
      if (bestY <= EPSILON) break // y=0 已是全局最优，无需再看
    }
  }
  return bestStart === -1 ? null : { sheetIdx: 0, y: bestY, x: bestX, start: bestStart, end: bestEnd }
}

/** 在 skyline 上落下零件，返回新 skyline */
function placeOnSkyline(segs: SkylineSeg[], fit: Fit, w: number, h: number): SkylineSeg[] {
  const newSegs: SkylineSeg[] = []
  for (let k = 0; k < fit.start; k++) newSegs.push(segs[k])
  const leftCover = fit.x - segs[fit.start].x
  if (leftCover > EPSILON) {
    newSegs.push({ x: segs[fit.start].x, y: segs[fit.start].y, w: leftCover })
  }
  newSegs.push({ x: fit.x, y: fit.y + h, w })
  const rightEnd = segs[fit.end].x + segs[fit.end].w
  const rightCover = rightEnd - (fit.x + w)
  if (rightCover > EPSILON) {
    newSegs.push({ x: fit.x + w, y: segs[fit.end].y, w: rightCover })
  }
  for (let k = fit.end + 1; k < segs.length; k++) newSegs.push(segs[k])
  // 合并相邻同高段
  const merged: SkylineSeg[] = []
  for (const s of newSegs) {
    const last = merged[merged.length - 1]
    if (last && Math.abs(last.y - s.y) <= EPSILON && Math.abs(last.x + last.w - s.x) <= EPSILON) {
      last.w += s.w
    } else {
      merged.push({ ...s })
    }
  }
  return merged
}

/**
 * 单方向可行性谓词 —— 排样可行性的**唯一判定**（预检与 pickSpec 共用，杜绝
 * “预检说能装、packer 装不下”这类判定漂移 bug）。
 * slotLen/slotWid 为槽空间尺寸（含 kerf）；usableLen/usableWid 为规格可用区（trim 已扣）。
 */
export function fitsSlot(
  slotLen: number,
  slotWid: number,
  usableLen: number,
  usableWid: number,
  kerf: number,
): boolean {
  return slotLen <= usableLen + kerf + EPSILON && slotWid <= usableWid + kerf + EPSILON
}

/** 双方向可行性：可旋转零件任一方向能装进规格；缺省 rotatable = false（禁止旋转） */
export function fitsAnyOrientation(
  item: Pick<PackItem, 'slotLen' | 'slotWid' | 'rotatable'>,
  entry: SheetLibraryEntry,
  kerf: number,
): boolean {
  if (fitsSlot(item.slotLen, item.slotWid, entry.usableLen, entry.usableWid, kerf)) return true
  if (!item.rotatable) return false
  return fitsSlot(item.slotWid, item.slotLen, entry.usableLen, entry.usableWid, kerf)
}

/** 生成旋转 90° 的副本（不原地修改——search 与调用方共享实例引用，原地改会把旋转状态泄漏进调用方） */
function swapOrientation(item: PackItem): PackItem {
  return {
    ...item,
    slotLen: item.slotWid,
    slotWid: item.slotLen,
    len: item.wid,
    wid: item.len,
    rotated: !item.rotated,
  }
}

/**
 * 将实例序列按序排入若干张板（多板全局最低位置）。
 * 开新板时从板材库中选择「能装下当前零件、可用面积最小」的规格；
 * 指定了 sheetId 的零件只能放入指定规格的板（或开指定规格的新板）。
 * 可旋转零件（rotatable）在“当前方向所有合格板都放不下”时自动旋转重试一轮——
 * 仅保证可行性（旋转-only-fit 可排），不参与质量决策（不贪婪双方向）。
 * 返回 sheets 为空表示当前零件放不进任何可用规格——调用方需预先过滤（预检 fitsAnyOrientation）。
 */
export function packSequence(
  items: PackItem[],
  library: SheetLibraryEntry[],
  kerf: number,
): PackResult {
  const sheets: PackedSheet[] = []
  /** 每张板的当前最大深度（skyline 最低 y） */
  const depths: number[] = []

  /** 选择开板规格：能装下 item 槽尺寸（fitsSlot 单一判定）、可用面积最小；指定 sheetId 时只用该规格 */
  const pickSpec = (item: PackItem): SheetLibraryEntry | null => {
    let best: SheetLibraryEntry | null = null
    for (const spec of library) {
      if (item.sheetId && spec.id !== item.sheetId) continue
      if (!fitsSlot(item.slotLen, item.slotWid, spec.usableLen, spec.usableWid, kerf)) continue
      if (!best || spec.usableLen * spec.usableWid < best.usableLen * best.usableWid) best = spec
    }
    return best
  }

  const openSheet = (spec: SheetLibraryEntry) => {
    sheets.push({
      sheetSpecId: spec.id,
      placements: [],
      skyline: [{ x: 0, y: 0, w: spec.usableLen + kerf }],
      slotLen: spec.usableLen + kerf,
      slotWid: spec.usableWid + kerf,
    })
    depths.push(0)
  }

  /** 所有现有板中最低可行位置（同 y 最左，含 sheetId 过滤）；null = 全部放不下 */
  const findBest = (w: number, h: number, sheetId?: string): Fit | null => {
    let best: Fit | null = null
    for (let s = 0; s < sheets.length; s++) {
      if (sheetId && sheets[s].sheetSpecId !== sheetId) continue
      const f = bestFit(sheets[s].skyline, w, h, sheets[s].slotWid, depths[s])
      if (!f) continue
      if (!best || f.y < best.y - EPSILON || (Math.abs(f.y - best.y) <= EPSILON && f.x < best.x)) {
        best = { ...f, sheetIdx: s }
        // y=0 已是全局最优
        if (best.y <= EPSILON) break
      }
    }
    return best
  }

  for (const item0 of items) {
    let item = item0
    let best = findBest(item.slotLen, item.slotWid, item.sheetId)
    // 保证性 fallback：当前方向全板放不下且可旋转 → 旋转方向重试一轮（确定性：严格先原方向、后旋转）
    if (!best && item.rotatable) {
      const swapped = swapOrientation(item)
      best = findBest(swapped.slotLen, swapped.slotWid, swapped.sheetId)
      if (best) item = swapped
    }

    if (!best) {
      // 全部板放不下（或规格不匹配）→ 开新板：先测当前方向；无规格匹配且可旋转时再测旋转方向
      let spec = pickSpec(item)
      if (!spec && item.rotatable) {
        item = swapOrientation(item)
        spec = pickSpec(item)
      }
      if (!spec) return { sheets: [] }
      openSheet(spec)
      best = { sheetIdx: sheets.length - 1, y: 0, x: 0, start: 0, end: 0 }
    }

    const sheet = sheets[best.sheetIdx]
    sheet.placements.push({ item, x: best.x, y: best.y })
    sheet.skyline = placeOnSkyline(sheet.skyline, best, item.slotLen, item.slotWid)
    // 精确深度：新 skyline 的最低 y（用于后续快速过滤）
    let minY = sheet.skyline[0]?.y ?? 0
    for (let k = 1; k < sheet.skyline.length; k++) {
      if (sheet.skyline[k].y < minY) minY = sheet.skyline[k].y
    }
    depths[best.sheetIdx] = minY
  }

  // 空板兜底（空输入时保证结果结构合法）
  if (sheets.length === 0 && items.length === 0 && library.length > 0) {
    const spec = library[0]
    openSheet(spec)
  }
  return { sheets }
}
