/**
 * 切割图零件色板 —— 12 色高区分度、相邻不撞色（UI-DESIGN.md §3.4）。
 * 独立于 UI 主题；避开强调色（橙）与语义色（警告黄），防止与选中态混淆。
 * 纯数据模块（domain 纯净：无 UI 依赖），网页 SVG 与 PDF 导出共用 —— 无白色/近白，避免与板材底色混淆。
 */
export const PART_PALETTE = [
  '#4263EB', // indigo
  '#0CA678', // teal
  '#E64980', // pink
  '#7048E8', // violet
  '#1098AD', // cyan
  '#74B816', // olive
  '#C92A2A', // red
  '#5F3DC4', // grape
  '#1C7ED6', // blue
  '#A61E4D', // raspberry
  '#2B8A3E', // green
  '#862E9C', // purple
] as const

/** 零件基础色：id 哈希取色（确定性） */
export function basePartColor(partId: string): number {
  let h = 5381
  for (let i = 0; i < partId.length; i++) h = ((h << 5) + h + partId.charCodeAt(i)) | 0
  return ((h >>> 0) % PART_PALETTE.length + PART_PALETTE.length) % PART_PALETTE.length
}

/**
 * 同板相邻零件强制不同色：
 * 按放置顺序取色，与上一放置同色则顺移一位（再与上一位比较，最多试 12 次）。
 */
export function sheetPartColors(partIds: string[]): number[] {
  const colors: number[] = []
  for (let i = 0; i < partIds.length; i++) {
    let c = basePartColor(partIds[i])
    if (i > 0 && c === colors[i - 1]) {
      c = (c + 1) % PART_PALETTE.length
      if (i > 1 && c === colors[i - 1]) c = (c + 1) % PART_PALETTE.length
    }
    colors.push(c)
  }
  return colors
}
