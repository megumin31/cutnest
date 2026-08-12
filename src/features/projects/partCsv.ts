/**
 * 零件表 CSV 序列化 / 解析 —— 零件工作区「导入 / 导出」工具（UI-DESIGN.md §6.2）。
 * 导出列：名称,长,宽,数量,旋转,板材,封边（Excel 可直接打开）；
 * 导入兼容本格式与批量粘贴文本格式（"名称 长 宽 [数量]"）。
 */
import type { Part, Quantity } from '../../domain/types'
import { qty } from '../../domain/types'

export interface PartRow {
  name: string
  length: number
  width: number
  quantity: Quantity
  grain?: 'alongLength' | 'any'
  sheetId?: string
  edgeBand?: ('L' | 'R' | 'T' | 'B')[]
}

const HEADERS = ['名称', '长度', '宽度', '数量', '旋转', '板材', '封边']

/**
 * CSV 表头已知列名（首行 ≥2 个匹配才判为表头）。
 * 数据行零件名可能恰好叫 name/Name/名称，但整行最多命中 1 个已知列名，不会误判。
 */
const KNOWN_HEADER_CELLS = [
  '名称', 'name', 'Name',
  '长度', '长', 'length',
  '宽度', '宽', 'width',
  '数量', 'qty', 'quantity',
  '旋转', '板材', '封边',
]

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export function serializePartsCsv(parts: Part[], sheetNameOf: (sheetId: string) => string | undefined): string {
  // UTF-8 BOM：Excel 按 GBK 打开无 BOM 的 UTF-8 文件会乱码（Windows 默认 ANSI）
  const lines = [HEADERS.join(',')]
  for (const p of parts) {
    lines.push(
      [
        csvCell(p.name),
        p.length,
        p.width,
        p.quantity,
        p.grain === 'any' ? '可旋转' : '不可旋转',
        csvCell(p.sheetId ? sheetNameOf(p.sheetId) ?? p.sheetId : '任意'),
        csvCell((p.edgeBand ?? []).join('')),
      ].join(','),
    )
  }
  return '\uFEFF' + lines.join('\n') + '\n'
}

/** 解析一行：CSV 逗号分隔（含引号转义）或批量粘贴的空格分隔；空行返回 null */
function parseLine(line: string): { cells: string[] } | null {
  const s = line.trim()
  if (!s) return null
  const cells: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQ = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQ = true
    } else if (ch === ',') {
      cells.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur)
  // 纯文本模式：整行无逗号 → 按空白分隔（名称 长 宽 [数量]）
  if (cells.length === 1) {
    const m = cells[0].match(/^(\S+)\s+([\d.]+)\s+([\d.]+)(?:\s+(\d+))?$/)
    if (!m) return null
    return { cells: [m[1]!, m[2]!, m[3]!, m[4] ?? '1'] }
  }
  return { cells }
}

/**
 * 导入文件解码：优先 UTF-8（含 UTF-16 BOM 检测）；
 * 若出现替换字符（U+FFFD，典型 GBK/ANSI 编码的中文被误按 UTF-8 读），尝试 GBK 兜底。
 */
export function decodeCsvText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer)
  }
  let text = new TextDecoder('utf-8').decode(buffer)
  if (text.includes('\uFFFD')) {
    try {
      const gbk = new TextDecoder('gbk').decode(buffer)
      if (!gbk.includes('\uFFFD')) text = gbk
    } catch {
      // 运行时不支持 gbk 解码器：保留 UTF-8 结果（编码问题由用户以 UTF-8 保存规避）
    }
  }
  return text
}

export function parsePartsCsv(text: string, sheetIdOf: (name: string) => string | undefined): PartRow[] {
  // 容忍 BOM（TextDecoder 通常已剥离，但直接传字符串时兜底）
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: PartRow[] = []
  const lines = src.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseLine(lines[i])
    if (!parsed) continue
    const cells = parsed.cells
    // 仅首行判定表头（数据行零件名恰好叫 name/Name/名称 不被误跳）
    if (i === 0 && cells.filter((c) => KNOWN_HEADER_CELLS.includes(c)).length >= 2) continue
    if (cells.length < 3) continue
    const len = Number(cells[1])
    const wid = Number(cells[2])
    if (!Number.isFinite(len) || !Number.isFinite(wid) || len <= 0 || wid <= 0) continue
    // 数量与工作区输入同一更正语义（qty 截断：2.9→2、0.4→0；0 = 不参与计算）
    const quantity = cells.length > 3 ? qty(Number(cells[3])) : qty(1)
    const g = (cells[4] ?? '').trim().toLowerCase()
    const grain: 'alongLength' | 'any' | undefined = /^(不可|no|false)/.test(g)
      ? 'alongLength'
      : /^(可|any|true|yes)/.test(g)
        ? 'any'
        : undefined
    const sheetRaw = (cells[5] ?? '').trim()
    const sheetId =
      sheetRaw && sheetRaw !== '任意' && sheetRaw.toLowerCase() !== 'any' ? sheetIdOf(sheetRaw) : undefined
    const edgeRaw = cells[6] ?? ''
    const edgeBand = (edgeRaw.match(/[LRBT]/g) ?? []).filter((v, i, arr) => arr.indexOf(v) === i) as (
      | 'L'
      | 'R'
      | 'T'
      | 'B'
    )[]
    rows.push({
      name: cells[0].trim(),
      length: Math.round(len),
      width: Math.round(wid),
      quantity,
      grain,
      sheetId,
      edgeBand: edgeBand.length > 0 ? edgeBand : undefined,
    })
  }
  return rows
}
