/**
 * 切割图零件色板 —— 12 色奶油淡彩（S 18~26%、L 79~91%，以用户参考色 #EEE4E3 ≈ hsl(5°,24%,91%) 为基准调性）、
 * 高区分度（UI-DESIGN.md §3.4）：相邻色相设计间隔 ≥27°（hex 量化后 ≥24°）+ 明度梯度双通道（暖亮冷暗：粉 91 → 蓝 79），
 * 低饱和下依然可分。独立于 UI 主题；避开强调色（橙）与语义色（警告黄），防止与选中态混淆。
 * 色系选择：红粉/品红/紫/蓝/绿/黄绿/橄榄/驼棕，奶油质感，与灰色余料底色可区分（低饱和青灰调已弃用）。
 * 纯数据模块（domain 纯净：无 UI 依赖），网页 SVG 与 PDF 导出共用 —— 无白色/近白，避免与板材底色混淆。
 */
export const PART_PALETTE = [
  '#EDE3E4', // rose (352°)
  '#E0D0E1', // magenta (297°)
  '#D4CBDD', // violet (270°)
  '#C5C4D9', // blue violet (242°)
  '#BCC8D7', // blue (214°)
  '#CCDEE0', // sky blue (186°)
  '#C0D8CF', // emerald (158°)
  '#C7DBCA', // green (130°)
  '#D2E0CC', // yellow green (104°)
  '#D6DAC8', // olive (74°)
  '#E2DFD5', // pale olive (47°)
  '#DDD0CA', // tan (20°)
] as const

/** hex 颜色 → 向白（amt>0）/向黑（amt<0）线性偏移，结果钳制在 [0,255]；用于零件填充微渐变端点 */
export function shadeHex(hex: string, amt: number): string {
  const shift = (v: number) => Math.round(Math.min(255, Math.max(0, v + amt * 255)))
  return `#${[1, 3, 5]
    .map((i) => shift(parseInt(hex.slice(i, i + 2), 16)).toString(16).padStart(2, '0').toUpperCase())
    .join('')}`
}

/** 零件基础色：id 哈希取色（确定性） */
export function basePartColor(partId: string): number {
  let h = 5381
  for (let i = 0; i < partId.length; i++) h = ((h << 5) + h + partId.charCodeAt(i)) | 0
  return ((h >>> 0) % PART_PALETTE.length + PART_PALETTE.length) % PART_PALETTE.length
}

/**
 * 同板相邻零件避撞取色（同类零件永远同色）：
 * 按放置顺序取色，仅当相邻零件为**不同零件**且同色时，后者顺移一位。
 * 同类零件（相同 partId）绝不顺移 —— 同类同色是硬规则，靠黑色描边区分相邻同类。
 */
export function sheetPartColors(partIds: string[]): number[] {
  const colors: number[] = []
  for (let i = 0; i < partIds.length; i++) {
    let c = basePartColor(partIds[i])
    if (i > 0 && partIds[i] !== partIds[i - 1] && c === colors[i - 1]) {
      c = (c + 1) % PART_PALETTE.length
    }
    colors.push(c)
  }
  return colors
}
