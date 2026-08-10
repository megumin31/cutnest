/**
 * PDF 导出 —— 给人看：交付客户/沟通/存档。
 * A4 横版：首页摘要（公司抬头/统计/水印）→ 每张板一页（零件标注 + 利用率）。
 * 零件用切割图色板彩色填充（与网页一致，UI-DESIGN.md §3.4），无白色以免与板材底色混淆；
 * 水印斜排低透明度。
 *
 * 首页摘要统计卡片与网页方案总览（StatsPanel）保持一致：板材数/利用率/零件总面积/封边长度/
 * 余料面积/可再利用块/最大余料块；价格永不入 PDF（报价属商业信息，不出现在交付图纸）。
 *
 * 字体：拉丁用 jsPDF 内置 Helvetica（零依赖）；CJK/泰文需要嵌入字体 ——
 * 本模块只消费外部提供的字体缓冲（infra/fonts 负责按需下载/缓存/子集化），
 * 保持 domain 纯净（不碰 fetch/IndexedDB）。
 */
import { jsPDF, GState } from 'jspdf'
import type { CutPlan } from '../types'
import { formatLength, formatSqm, type LengthUnit } from '../units'
import { PART_PALETTE, sheetPartColors } from '../palette'
import { toScene } from './toScene'
import { wasteRegionsOfLayout } from '../optimizer/evaluate'

export interface PdfLabels {
  /** 项目名 */
  projectName: string
  /** 公司名（可能为空字符串） */
  companyName: string
  companyAddress: string
  companyPhone: string
  /** 页脚统计标签 */
  sheetsLabel: string
  utilizationLabel: string
  wasteLabel: string
  reusableLabel: string
  largestLabel: string
  /** 零件总面积标签（摘要卡片） */
  partArea: string
  /** 封边长度标签（摘要卡片） */
  edgeMeters: string
  /** 板材库行标签（摘要页信息行） */
  sheetLibraryLabel: string
  /** 零件数量标签（页脚用） */
  partCountLabel: string
  /** 日期文本（调用方已格式化） */
  dateText: string
  /** 水印文本；null = 无水印 */
  watermark: string | null
  unit: LengthUnit
}

export interface PdfFonts {
  /** CJK 字体缓冲（TTF/OTF），文本含 CJK 字符时必需 */
  cjk?: ArrayBuffer
  /** 泰文字体缓冲（TTF/OTF），文本含泰文时必需 */
  thai?: ArrayBuffer
}

export interface PdfResult {
  bytes: Uint8Array
  pageCount: number
}

export class PdfFontError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PdfFontError'
  }
}

/**
 * 渲染中由格式化函数动态拼出的字符（尺寸 × 尺寸、分隔 ·、百分比、m²、页码 /、省略号 …）——
 * 不在词条与零件名里，子集化必须额外保留（缺字 → 豆腐块）。
 * 注意：只允许 ASCII + 拉丁补充符号，绝不可包含 CJK/全角/泰文字符，否则 needsCjkFont/needsThaiFont 误判。
 */
const FORMAT_GLYPHS = (() => {
  let s = ''
  for (let c = 0x20; c <= 0x7e; c++) s += String.fromCharCode(c)
  return s + '×·²…—'
})()

/** 文本是否需要 CJK 字体（CJK 统一表意文字 + 扩展区 + 全角符号 + 谚文） */
export function needsCjkFont(texts: string[]): boolean {
  const cjkRe = /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/
  // 扩展 B 区及以上（BMP 之外，须 u 标志）
  const extRe = /[\u{20000}-\u{2fa1f}]/u
  for (const t of texts) {
    if (cjkRe.test(t)) return true
    if (extRe.test(t)) return true
  }
  return false
}

/** 文本是否需要泰文字体（泰文音节块 \u0e00-\u0e7f，拉丁组字体不含泰文字形） */
export function needsThaiFont(texts: string[]): boolean {
  for (const t of texts) {
    if (/[\u0e00-\u0e7f]/.test(t)) return true
  }
  return false
}

/** 整份文档实际绘制的全部文本（词条标签 + 用户输入 + 格式化动态字符）——字体决策与子集化必须用它 */
export function pdfTexts(labels: PdfLabels, partNames: Map<string, string>): string[] {
  return [
    labels.projectName,
    labels.companyName,
    labels.companyAddress,
    labels.companyPhone,
    labels.sheetsLabel,
    labels.utilizationLabel,
    labels.wasteLabel,
    labels.reusableLabel,
    labels.largestLabel,
    labels.partArea,
    labels.edgeMeters,
    labels.sheetLibraryLabel,
    labels.partCountLabel,
    labels.dateText,
    labels.watermark ?? '',
    ...partNames.values(),
    FORMAT_GLYPHS,
  ]
}

const MARGIN = 10
const HEADER_H = 22

/** CJK/泰文子集字体仅注册 normal 字重，三写模拟加粗的水平偏移 */
const BOLD_OFFSET = 0.07

/** CJK/泰文子集字体仅注册 normal 字重，需要三写模拟加粗 */
function cjkOrThai(ctx: Layout): boolean {
  return ctx.cjkMode || ctx.thaiMode
}

interface Layout {
  doc: jsPDF
  labels: PdfLabels
  fonts: PdfFonts
  cjkMode: boolean
  thaiMode: boolean
  /** 字体设置必须走这里：cjkMode 下统一切到嵌入的 NotoSC，禁止直接 setFont('helvetica') */
  setFont: (style: 'normal' | 'bold') => void
}

function fmt(labels: PdfLabels, mm: number): string {
  return formatLength(mm, labels.unit)
}

interface DrawTextOpts {
  size?: number
  bold?: boolean
  color?: [number, number, number]
  align?: 'left' | 'center' | 'right'
  angle?: number
  /** 超过则省略号截断 */
  maxWidth?: number
}

/** 超宽文本省略号截断（需先设置字体/字号再测量） */
function ellipsize(doc: jsPDF, text: string, maxWidth: number): string {
  if (doc.getTextWidth(text) <= maxWidth) return text
  let lo = 1
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (doc.getTextWidth(text.slice(0, mid)) <= maxWidth) lo = mid
    else hi = mid - 1
  }
  const head = text.slice(0, lo)
  return doc.getTextWidth(head + '…') <= maxWidth ? head + '…' : head.slice(0, -1) + '…'
}

/**
 * 统一文本出口：设置字体/字号/颜色并绘制。
 * CJK/泰文子集字体无 bold 字重 → 加粗用水平三写模拟（拉丁走真实 bold）。
 */
function drawText(ctx: Layout, text: string, x: number, y: number, opts: DrawTextOpts = {}): void {
  const { doc } = ctx
  const bold = opts.bold ?? false
  ctx.setFont(bold ? 'bold' : 'normal')
  if (opts.size !== undefined) doc.setFontSize(opts.size)
  if (opts.color) doc.setTextColor(opts.color[0], opts.color[1], opts.color[2])
  if (opts.maxWidth !== undefined) text = ellipsize(doc, text, opts.maxWidth)
  const base: { align?: 'left' | 'center' | 'right'; angle?: number } = {}
  if (opts.align) base.align = opts.align
  if (opts.angle !== undefined) base.angle = opts.angle
  if (bold && cjkOrThai(ctx)) {
    doc.text(text, x - BOLD_OFFSET, y, base)
    doc.text(text, x + BOLD_OFFSET, y, base)
  }
  doc.text(text, x, y, base)
}

/**
 * 零件标注（白字 + 深色 halo）：halo 偏移随字号缩放（近似网页 paint-order stroke）。
 * CJK/泰文下三写模拟加粗。
 */
function drawLabelText(
  ctx: Layout,
  text: string,
  x: number,
  y: number,
  size: number,
  align: 'left' | 'center' | 'right',
): void {
  const { doc } = ctx
  const halo = Math.max(0.25, size * 0.06)
  doc.setFontSize(size)
  doc.setTextColor(24, 24, 27)
  const offsets: [number, number][] = [
    [-halo, -halo],
    [halo, -halo],
    [-halo, halo],
    [halo, halo],
  ]
  for (const [dx, dy] of offsets) doc.text(text, x + dx, y + dy, { align })
  ctx.setFont(cjkOrThai(ctx) ? 'normal' : 'bold')
  if (cjkOrThai(ctx)) {
    doc.setTextColor(255, 255, 255)
    doc.text(text, x - BOLD_OFFSET, y, { align })
    doc.text(text, x + BOLD_OFFSET, y, { align })
  }
  doc.setTextColor(255, 255, 255)
  doc.text(text, x, y, { align })
}

/** 按字符断行（CJK 无空格也安全），每行不超过 maxWidth；内部设置 9pt normal */
function wrapChars(ctx: Layout, text: string, maxWidth: number): string[] {
  ctx.setFont('normal')
  ctx.doc.setFontSize(9)
  const lines: string[] = []
  let line = ''
  for (const ch of text) {
    if (line && ctx.doc.getTextWidth(line + ch) > maxWidth) {
      lines.push(line)
      line = ch
    } else {
      line += ch
    }
  }
  if (line) lines.push(line)
  return lines
}

/** 页眉（公司 + 项目 + 日期 + 分隔线） */
function drawHeader(ctx: Layout) {
  const { doc, labels } = ctx
  const right = 297 - MARGIN
  const midX = 148.5
  const leftMax = midX - MARGIN - 6
  const rightMax = right - midX - 6
  // 左侧 = 公司名（无公司时用项目名），右侧 = 项目名（公司名非空时才显示，避免重复）；各自截断防重叠
  drawText(ctx, labels.companyName || labels.projectName, MARGIN, 12, {
    size: 11,
    bold: true,
    color: [24, 24, 27],
    maxWidth: leftMax,
  })
  drawText(ctx, labels.companyAddress || '', MARGIN, 16.5, { size: 9, color: [82, 82, 91], maxWidth: leftMax })
  drawText(ctx, labels.companyPhone || '', MARGIN, 20, { size: 9, color: [82, 82, 91], maxWidth: leftMax })
  if (labels.companyName) {
    drawText(ctx, labels.projectName, right, 12, { size: 10, align: 'right', color: [24, 24, 27], maxWidth: rightMax })
  }
  drawText(ctx, labels.dateText, right, 16.5, { size: 8.5, align: 'right', color: [82, 82, 91], maxWidth: rightMax })
  doc.setDrawColor(228, 228, 231)
  doc.setLineWidth(0.3)
  doc.line(MARGIN, HEADER_H - 2, right, HEADER_H - 2)
}

/** 水印：对角大文字，低透明度；超长自动缩小字号防溢出 */
function drawWatermark(ctx: Layout) {
  const { doc, labels } = ctx
  if (!labels.watermark) return
  doc.saveGraphicsState()
  doc.setGState(new GState({ opacity: 0.08 }))
  let size = 42
  while (size > 16) {
    ctx.setFont('bold')
    doc.setFontSize(size)
    if (doc.getTextWidth(labels.watermark) <= 230) break
    size -= 2
  }
  drawText(ctx, labels.watermark, 148.5, 120, {
    size,
    bold: true,
    color: [24, 24, 27],
    align: 'center',
    angle: 35,
  })
  doc.restoreGraphicsState()
}

/** 首页摘要：项目名 + 统计卡片网格（与网页方案总览一致，无价格）+ 板材库行 */
function drawSummary(ctx: Layout, plan: CutPlan) {
  const { doc, labels } = ctx
  const stats = plan.stats

  // 项目名（大字）+ 分隔线
  drawText(ctx, labels.projectName, MARGIN, 38, { size: 18, bold: true, color: [24, 24, 27], maxWidth: 277 })
  doc.setDrawColor(228, 228, 231)
  doc.setLineWidth(0.4)
  doc.line(MARGIN, 44, 297 - MARGIN, 44)

  // 统计卡片网格（4 列；顺序与网页 StatsPanel 一致；价格永不入 PDF）
  const items: [string, string][] = [
    [labels.sheetsLabel, String(stats.sheetCount)],
    [labels.utilizationLabel, `${stats.utilization.toFixed(1)}%`],
    [labels.partArea, formatSqm(stats.partArea ?? 0)],
    [labels.edgeMeters, `${(stats.edgeMeters ?? 0).toFixed(1)} m`],
    [labels.wasteLabel, formatSqm(stats.wasteArea)],
    [labels.reusableLabel, String(stats.reusableWasteBlocks)],
    [labels.largestLabel, formatSqm(stats.largestReusableWaste)],
  ]
  const cols = 4
  const colW = (297 - 2 * MARGIN - (cols - 1) * 8) / cols
  items.forEach(([k, v], i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = MARGIN + col * (colW + 8)
    const y = 54 + row * 30
    doc.setFillColor(247, 247, 248)
    doc.setDrawColor(228, 228, 231)
    doc.setLineWidth(0.3)
    doc.roundedRect(x, y, colW, 22, 3, 3, 'FD')
    drawText(ctx, k, x + 8, y + 8.5, { size: 8.5, color: [82, 82, 91] })
    drawText(ctx, v, x + 8, y + 17.5, { size: 14, bold: true, color: [24, 24, 27], maxWidth: colW - 16 })
  })

  // 板材库说明（按字符换行，多规格/长文本不溢出）
  const specs = plan.sheetLibrary
    .map((s) => `${s.name} ${fmt(labels, s.length)}×${fmt(labels, s.width)} ${labels.unit}`)
    .join(' · ')
  const lines = wrapChars(ctx, `${labels.sheetLibraryLabel}: ${specs}`, 297 - 2 * MARGIN)
  for (let i = 0; i < lines.length; i++) {
    drawText(ctx, lines[i], MARGIN, 122 + i * 5.5, { size: 9, color: [82, 82, 91] })
  }
}

/** 绘制一张板：边框 + 零件矩形 + 封边标注 + 文字标注 */
function drawSheetPage(
  ctx: Layout,
  plan: CutPlan,
  sheetIdx: number,
  partNames: Map<string, string>,
  edgeBands?: Map<string, ('L' | 'R' | 'T' | 'B')[]>,
) {
  const { doc, labels } = ctx
  const scene = toScene(plan, plan.sheetLibrary, partNames, edgeBands)[sheetIdx]
  if (!scene) return

  const usableLen = scene.usableLen
  const usableWid = scene.usableWid
  const availW = 297 - 2 * MARGIN
  const availH = 210 - HEADER_H - MARGIN - 14
  const scale = Math.min(availW / usableLen, availH / usableWid)
  const dw = usableLen * scale
  const dh = usableWid * scale
  const ox = MARGIN
  const oy = HEADER_H + 6

  // 单板标题：纯数字页码（不经过 i18n 前后缀）
  drawText(ctx, `${sheetIdx + 1} / ${plan.stats.sheetCount}`, MARGIN, HEADER_H + 1, {
    size: 11,
    bold: true,
    color: [24, 24, 27],
  })
  drawText(
    ctx,
    `${fmt(labels, usableLen)} × ${fmt(labels, usableWid)} ${labels.unit} · ${labels.utilizationLabel} ${scene.utilization.toFixed(1)}%`,
    MARGIN + 24,
    HEADER_H + 1,
    { size: 8.5, color: [82, 82, 91] },
  )

  // 板材边框（浅灰细线，与网页切割图 text-secondary 对应）
  doc.setDrawColor(82, 82, 91)
  doc.setLineWidth(0.4)
  doc.rect(ox, oy, dw, dh)

  // 余料区：真实条带半透明灰（与网页 WASTE_FILL rgba(127,127,127,0.35) 一致）；
  // 槽空间最右/顶部含 kerf 走廊，超出可用区部分裁剪
  const wasteRegions = wasteRegionsOfLayout(
    scene.parts.map((p) => ({ x: p.x, y: p.y, len: p.len, wid: p.wid })),
    usableLen,
    usableWid,
    plan.settings.kerf,
  )
  for (const region of wasteRegions) {
    for (const s of region.strips) {
      const rx = Math.min(dw, Math.max(0, s.x * scale))
      const ry = Math.min(dh, Math.max(0, s.y * scale))
      const rw = Math.max(0, Math.min(dw - rx, s.w * scale))
      const rh = Math.max(0, Math.min(dh - ry, s.h * scale))
      if (rw < 0.05 || rh < 0.05) continue
      doc.saveGraphicsState()
      doc.setGState(new GState({ opacity: 0.35 }))
      doc.setFillColor(127, 127, 127)
      doc.rect(ox + rx, oy + ry, rw, rh, 'F')
      doc.restoreGraphicsState()
    }
  }

  // 零件（彩色填充 + 圆角 + 深灰描边，与网页切割图一致；无白色避免与板材底色混淆）
  const colorIdx = sheetPartColors(scene.parts.map((p) => p.partId))
  for (let i = 0; i < scene.parts.length; i++) {
    const p = scene.parts[i]
    const px = ox + p.x * scale
    const py = oy + p.y * scale
    const pw = p.len * scale
    const ph = p.wid * scale
    if (pw < 1 || ph < 1) continue
    const hex = PART_PALETTE[colorIdx[i] % PART_PALETTE.length]
    doc.setFillColor(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16))
    doc.setDrawColor(56, 56, 60)
    doc.setLineWidth(0.2)
    // 圆角与网页一致：rx = min(2, len/3, wid/3)（板 mm）按缩放换算
    const rx = Math.min(2, p.len / 3, p.wid / 3) * scale
    doc.roundedRect(px, py, pw, ph, rx, rx, 'FD')

    // 封边标注：加粗深色线画在需封边的边上（边内 0.55mm 内侧，视觉上"该边加厚"）。
    // 约定：T/B = 长度方向的边（沿 X 轴）、L/R = 宽度方向的边（沿 Y 轴）；
    // 零件旋转 90° 后 B→左竖边、T→右竖边、L→下横边、R→上横边
    //   （T/B 仍是"长度方向"的物理边、L/R 仍是"宽度方向"的物理边）
    const band = p.edgeBand ?? []
    if (band.length > 0) {
      doc.setDrawColor(24, 24, 27)
      doc.setLineWidth(1.1)
      const inset = 0.55
      if (p.rotated) {
        if (band.includes('B')) doc.line(px + inset, py, px + inset, py + ph)
        if (band.includes('T')) doc.line(px + pw - inset, py, px + pw - inset, py + ph)
        if (band.includes('L')) doc.line(px, py + inset, px + pw, py + inset)
        if (band.includes('R')) doc.line(px, py + ph - inset, px + pw, py + ph - inset)
      } else {
        if (band.includes('B')) doc.line(px, py + inset, px + pw, py + inset)
        if (band.includes('T')) doc.line(px, py + ph - inset, px + pw, py + ph - inset)
        if (band.includes('L')) doc.line(px + inset, py, px + inset, py + ph)
        if (band.includes('R')) doc.line(px + pw - inset, py, px + pw - inset, py + ph)
      }
    }

    // 标注：阈值与网页一致（真实面积 > 40000 mm²）；字号加大、白字加 halo 描边 + 模拟加粗
    if (p.len * p.wid > 40_000) {
      const centerX = px + pw / 2
      const centerY = py + ph / 2
      const namePt = Math.min(8.5, pw / 7, ph / 3)
      const dimPt = Math.max(4.5, Math.min(6.5, pw / 8.5, ph / 3.5))
      const nameY = centerY - namePt * 0.35
      const dimY = centerY + namePt * 0.5 + dimPt * 0.35
      drawLabelText(ctx, p.name, centerX, nameY, namePt, 'center')
      drawLabelText(ctx, `${fmt(labels, p.len)}×${fmt(labels, p.wid)}`, centerX, dimY, dimPt, 'center')
    }
  }

  // 页脚：板材统计
  const spec = plan.sheetLibrary.find((s) => s.id === plan.sheets[sheetIdx]?.sheetSpecId)
  drawText(
    ctx,
    `${spec?.name ?? ''}${spec ? ' · ' : ''}${labels.utilizationLabel} ${scene.utilization.toFixed(1)}% · ${scene.parts.length} ${labels.partCountLabel}`,
    MARGIN,
    210 - 8,
    { size: 8.5, color: [100, 100, 110], maxWidth: 210 },
  )
}

/**
 * 渲染 PDF。板材尺寸一律取自 plan.sheetLibrary（排样快照），
 * 与当前项目板材库无关 —— 历史方案重导出不会画错板型。
 */
export async function renderPDF(
  plan: CutPlan,
  partNames: Map<string, string>,
  labels: PdfLabels,
  fonts: PdfFonts = {},
  edgeBands?: Map<string, ('L' | 'R' | 'T' | 'B')[]>,
): Promise<PdfResult> {
  // 决定是否用 CJK/泰文字体（词条标签 + 用户输入全部参与判定；混合场景 CJK 优先）
  const allText = pdfTexts(labels, partNames)
  const needCjk = needsCjkFont(allText)
  const needThai = !needCjk && needsThaiFont(allText)
  if (needCjk && !fonts.cjk) {
    throw new PdfFontError('PDF 文本包含 CJK 字符，但未提供字体')
  }
  if (needThai && !fonts.thai) {
    throw new PdfFontError('PDF 文本包含泰文字符，但未提供字体')
  }
  const cjkMode = needCjk
  const thaiMode = needThai

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  if (cjkMode) {
    const buf = fonts.cjk as ArrayBuffer
    const b64 = arrayBufferToBase64(buf)
    doc.addFileToVFS('NotoSC.ttf', b64)
    doc.addFont('NotoSC.ttf', 'NotoSC', 'normal')
  }
  if (thaiMode) {
    const buf = fonts.thai as ArrayBuffer
    const b64 = arrayBufferToBase64(buf)
    doc.addFileToVFS('NotoThai.ttf', b64)
    doc.addFont('NotoThai.ttf', 'NotoThai', 'normal')
  }
  const ctx: Layout = {
    doc,
    labels,
    fonts,
    cjkMode,
    thaiMode,
    setFont: (style: 'normal' | 'bold') => {
      if (cjkMode) {
        // 子集化字体仅注册 normal 字重（加粗由 drawText 三写模拟）
        doc.setFont('NotoSC', 'normal')
      } else if (thaiMode) {
        // 泰文字体含拉丁字形，整档统一使用
        doc.setFont('NotoThai', 'normal')
      } else {
        doc.setFont('helvetica', style)
      }
    },
  }

  // 摘要页 + 每张板一页；右下角纯数字页码（1 / N，不依赖 i18n）
  const totalPages = 1 + plan.sheets.length
  const drawPageNum = (page: number) => {
    drawText(ctx, `${page} / ${totalPages}`, 297 - MARGIN, 210 - 8, {
      size: 8,
      color: [100, 100, 110],
      align: 'right',
    })
  }
  drawWatermark(ctx)
  drawHeader(ctx)
  drawSummary(ctx, plan)
  drawPageNum(1)

  for (let i = 0; i < plan.sheets.length; i++) {
    doc.addPage()
    drawWatermark(ctx)
    drawHeader(ctx)
    drawSheetPage(ctx, plan, i, partNames, edgeBands)
    drawPageNum(i + 2)
  }

  const bytes = new Uint8Array(doc.output('arraybuffer'))
  return { bytes, pageCount: doc.getNumberOfPages() }
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
