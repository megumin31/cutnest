/**
 * PDF 导出 —— 给人看：交付客户/沟通/存档。
 * A4 横版：首页摘要（公司抬头/统计/水印）→ 每张板一页（零件标注 + 利用率）。
 * 零件用切割图色板彩色填充（与网页一致，UI-DESIGN.md §3.4），无白色以免与板材底色混淆；
 * 水印斜排低透明度。
 *
 * 字体：拉丁用 jsPDF 内置 Helvetica（零依赖）；CJK/泰文需要嵌入字体 ——
 * 本模块只消费外部提供的字体缓冲（infra/fonts 负责按需下载/缓存/子集化），
 * 保持 domain 纯净（不碰 fetch/IndexedDB）。
 */
import { jsPDF, GState } from 'jspdf'
import type { CutPlan, SheetSpec } from '../types'
import { formatLength, type LengthUnit } from '../units'
import { PART_PALETTE, sheetPartColors } from '../palette'
import { toScene } from './toScene'

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
  costLabel: string
  wasteLabel: string
  reusableLabel: string
  largestLabel: string
  /** 单板标题前缀，如 "第 "；后接 "N / M" */
  sheetPrefix: string
  sheetSuffix: string
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

/** 文本是否需要 CJK 字体（CJK 统一表意文字 + 全角符号） */
export function needsCjkFont(texts: string[]): boolean {
  for (const t of texts) {
    // eslint-disable-next-line no-control-regex
    if (/[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff]/.test(t)) return true
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

/** 整份文档实际绘制的全部文本（词条标签 + 用户输入）——字体决策与子集化必须用它 */
export function pdfTexts(labels: PdfLabels, partNames: Map<string, string>): string[] {
  return [
    labels.projectName,
    labels.companyName,
    labels.companyAddress,
    labels.companyPhone,
    labels.sheetsLabel,
    labels.utilizationLabel,
    labels.costLabel,
    labels.wasteLabel,
    labels.reusableLabel,
    labels.largestLabel,
    labels.sheetPrefix,
    labels.sheetSuffix,
    labels.partCountLabel,
    labels.dateText,
    labels.watermark ?? '',
    ...partNames.values(),
  ]
}

const MARGIN = 10
const HEADER_H = 22

interface Layout {
  doc: jsPDF
  labels: PdfLabels
  fonts: PdfFonts
  cjkMode: boolean
  /** 字体设置必须走这里：cjkMode 下统一切到嵌入的 NotoSC，禁止直接 setFont('helvetica') */
  setFont: (style: 'normal' | 'bold') => void
}

function fmt(labels: PdfLabels, mm: number): string {
  return formatLength(mm, labels.unit)
}

/** 页眉（公司 + 项目 + 日期 + 分隔线） */
function drawHeader(l: Layout) {
  const { doc, labels } = l
  l.setFont('bold')
  doc.setFontSize(11)
  doc.setTextColor(24, 24, 27)
  doc.text(labels.companyName || labels.projectName, MARGIN, 12)
  l.setFont('normal')
  doc.setFontSize(9)
  doc.setTextColor(82, 82, 91)
  if (labels.companyAddress) doc.text(labels.companyAddress, MARGIN, 16.5)
  if (labels.companyPhone) doc.text(labels.companyPhone, MARGIN, 20)
  doc.setFontSize(10)
  doc.text(labels.projectName, 297 - MARGIN, 12, { align: 'right' })
  doc.setFontSize(8.5)
  doc.text(labels.dateText, 297 - MARGIN, 16.5, { align: 'right' })
  doc.setDrawColor(228, 228, 231)
  doc.setLineWidth(0.3)
  doc.line(MARGIN, HEADER_H - 2, 297 - MARGIN, HEADER_H - 2)
}

/** 水印：对角大文字，低透明度 */
function drawWatermark(l: Layout) {
  const { doc, labels } = l
  if (!labels.watermark) return
  doc.saveGraphicsState()
  doc.setGState(new GState({ opacity: 0.08 }))
  l.setFont('bold')
  doc.setFontSize(42)
  doc.setTextColor(24, 24, 27)
  doc.text(labels.watermark, 148.5, 120, { align: 'center', angle: 35 })
  doc.restoreGraphicsState()
}

/** 首页摘要：统计网格 */
function drawSummary(l: Layout, plan: CutPlan, sheetLibrary: SheetSpec[]) {
  const { doc, labels } = l
  l.setFont('bold')
  doc.setFontSize(16)
  doc.setTextColor(24, 24, 27)
  doc.text(labels.projectName, MARGIN, 40)

  const stats = plan.stats
  const items: [string, string][] = [
    [labels.sheetsLabel, String(stats.sheetCount)],
    [labels.utilizationLabel, `${stats.utilization.toFixed(1)}%`],
    [labels.costLabel, `¥${stats.totalCost.toFixed(0)}`],
    [labels.wasteLabel, `${(stats.wasteArea / 1e6).toFixed(2)} m²`],
    [labels.reusableLabel, String(stats.reusableWasteBlocks)],
    [labels.largestLabel, `${Math.round(stats.largestReusableWaste / 1e6 * 100) / 100} m²`],
  ]
  const colW = (297 - 2 * MARGIN - 3 * 8) / 3
  items
    .filter(([k]) => k !== '')
    .forEach(([k, v], i) => {
    const col = i % 3
    const row = Math.floor(i / 3)
    const x = MARGIN + col * (colW + 8)
    const y = 56 + row * 26
    doc.setFillColor(247, 247, 248)
    doc.setDrawColor(228, 228, 231)
    doc.setLineWidth(0.3)
    doc.roundedRect(x, y, colW, 20, 2, 2, 'FD')
    l.setFont('normal')
    doc.setFontSize(8)
    doc.setTextColor(82, 82, 91)
    doc.text(k, x + 6, y + 7.5)
    l.setFont('bold')
    doc.setFontSize(12)
    doc.setTextColor(24, 24, 27)
    doc.text(v, x + 6, y + 15.5)
  })

  // 板材库说明（全部规格）
  l.setFont('normal')
  doc.setFontSize(9)
  doc.setTextColor(82, 82, 91)
  doc.text(
    sheetLibrary
      .map((s) => `${s.name} · ${fmt(labels, s.length)} × ${fmt(labels, s.width)} ${labels.unit}`)
      .join('　｜　'),
    MARGIN,
    132,
  )
  doc.setFontSize(8)
  doc.text(`${labels.sheetPrefix}1 ${labels.sheetSuffix}`, MARGIN, 296 - MARGIN - 8, { align: 'left' })
}

/** 绘制一张板：边框 + 零件矩形 + 封边标注 + 文字标注 */
function drawSheetPage(
  l: Layout,
  plan: CutPlan,
  sheetLibrary: SheetSpec[],
  sheetIdx: number,
  partNames: Map<string, string>,
  edgeBands?: Map<string, ('L' | 'R' | 'T' | 'B')[]>,
) {
  const { doc, labels } = l
  const scene = toScene(plan, sheetLibrary, partNames, edgeBands)[sheetIdx]
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

  // 单板标题
  l.setFont('bold')
  doc.setFontSize(10)
  doc.setTextColor(24, 24, 27)
  doc.text(
    `${labels.sheetPrefix}${sheetIdx + 1} / ${plan.stats.sheetCount}${labels.sheetSuffix}`,
    MARGIN,
    HEADER_H + 1,
  )
  l.setFont('normal')
  doc.setFontSize(8.5)
  doc.setTextColor(82, 82, 91)
  doc.text(
    `${fmt(labels, usableLen)} × ${fmt(labels, usableWid)} ${labels.unit} · ${labels.utilizationLabel} ${scene.utilization.toFixed(1)}%`,
    MARGIN + 45,
    HEADER_H + 1,
  )

  // 板材边框
  doc.setDrawColor(24, 24, 27)
  doc.setLineWidth(0.6)
  doc.rect(ox, oy, dw, dh)

  // 零件（彩色填充，与网页切割图一致；无白色避免与板材底色混淆）
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
    doc.setDrawColor(24, 24, 27)
    doc.setLineWidth(0.25)
    doc.rect(px, py, pw, ph, 'FD')

    // 封边标注：加粗深色线画在需封边的边上（边内 0.55mm 内侧，视觉上"该边加厚"）。
    // 约定：T/B = len 方向两条长边、L/R = wid 方向两条短边；零件旋转 90° 后
    //   B→左竖边、T→右竖边、L→下横边、R→上横边（与未旋转时 T/B 上下、L/R 左右一致）
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

    // 标注（零件太小则不画文字；深色偏移阴影保证白字在亮色零件上可读）
    if (pw > 22 && ph > 8) {
      const centerX = px + pw / 2
      const centerY = py + ph / 2
      l.setFont('normal')
      doc.setFontSize(Math.min(7, pw / 8, ph / 3.2))
      doc.setTextColor(24, 24, 27)
      doc.text(p.name, centerX + 0.2, centerY - 0.4, { align: 'center' })
      doc.setTextColor(255, 255, 255)
      doc.text(p.name, centerX, centerY - 0.6, { align: 'center' })
      l.setFont('normal')
      doc.setFontSize(Math.max(5, Math.min(7, pw / 9, ph / 3.4)))
      doc.setTextColor(24, 24, 27)
      doc.text(`${fmt(labels, p.len)}×${fmt(labels, p.wid)}`, centerX + 0.2, centerY + 3, { align: 'center' })
      doc.setTextColor(255, 255, 255)
      doc.text(`${fmt(labels, p.len)}×${fmt(labels, p.wid)}`, centerX, centerY + 2.8, { align: 'center' })
    }
  }

  // 页脚：板材统计
  const spec = sheetLibrary.find((s) => s.id === plan.sheets[sheetIdx]?.sheetSpecId)
  doc.setFontSize(8)
  doc.setTextColor(130, 130, 140)
  doc.text(
    `${spec?.name ?? ''}${spec ? ' · ' : ''}${labels.utilizationLabel} ${scene.utilization.toFixed(1)}% · ${scene.parts.length} ${labels.partCountLabel}`,
    MARGIN,
    210 - 8,
  )
}

export async function renderPDF(
  plan: CutPlan,
  sheetLibrary: SheetSpec[],
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
  const l: Layout = {
    doc,
    labels,
    fonts,
    cjkMode,
    setFont: (style: 'normal' | 'bold') => {
      if (cjkMode) {
        // 子集化字体仅注册 normal 字重
        doc.setFont('NotoSC', 'normal')
      } else if (thaiMode) {
        // 泰文字体含拉丁字形，整档统一使用
        doc.setFont('NotoThai', 'normal')
      } else {
        doc.setFont('helvetica', style)
      }
    },
  }

  // 摘要页
  drawWatermark(l)
  drawHeader(l)
  drawSummary(l, plan, sheetLibrary)

  // 每张板一页
  for (let i = 0; i < plan.sheets.length; i++) {
    doc.addPage()
    drawWatermark(l)
    drawHeader(l)
    drawSheetPage(l, plan, sheetLibrary, i, partNames, edgeBands)
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
