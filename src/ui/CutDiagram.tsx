/**
 * 切割图可视化（视觉主角，UI-DESIGN.md §7）——
 * 零件矩形填充色板渐变（上亮下暗微过渡）、圆角 2px、黑色描边 1.2px；余料区半透明浅灰；
 * 悬停高亮 + 点击选中（强调色描边）。支持卡片模式（自适应）与单板大图模式（缩放/平移）。
 */
import { useId, useMemo, useRef, useState } from 'react'
import type { CutPlan, SheetSpec } from '../domain/types'
import { usableArea } from '../domain/optimizer'
import { wasteRegionsOfLayout } from '../domain/optimizer/evaluate'
import { PART_PALETTE, shadeHex, sheetPartColors } from '../domain/palette'
import { formatLength, type LengthUnit } from '../domain/units'
import { partKey } from '../features/cutting/planStore'

export interface CutDiagramProps {
  plan: CutPlan
  sheet: SheetSpec
  sheetIndex: number
  unit: LengthUnit
  selectedKey?: string | null
  hoverKey?: string | null
  interactive?: boolean
  onSelect?: (key: string | null) => void
  onHover?: (key: string | null) => void
  /** 零件名查询 */
  partNameOf?: (partId: string) => string | undefined
  /** 大图模式：支持缩放平移 */
  detail?: boolean
}

const WASTE_FILL = 'rgba(127,127,127,0.15)'

/** 内侧尺寸标注参数（板 mm 单位）：数字距零件边的距离 */
const DIM_INSET = 4

/** 填充微渐变幅度：向白/黑偏移的比例（“一点点”过渡，克制不抢文字） */
const GRAD_AMT = 0.045

export function CutDiagram(props: CutDiagramProps) {
  const { plan, sheet, sheetIndex, unit, interactive = true, detail = false } = props
  const layout = plan.sheets[sheetIndex]
  const usable = useMemo(() => usableArea(sheet, plan.settings), [sheet, plan.settings])
  /** 渐变 id 前缀：多张板卡同页渲染时避免 SVG id 冲突（useId 含冒号，url() 引用前去除） */
  const gradPrefix = useId().replace(/:/g, '')

  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null)
  /** 拖拽是否产生位移（>3px）：有位移的拖拽不是点击，点击空白清空选中须被抑制 */
  const movedRef = useRef(false)

  const wasteRegions = useMemo(
    () =>
      layout
        ? wasteRegionsOfLayout(
            layout.placements.map((p) => ({ x: p.x, y: p.y, len: p.len, wid: p.wid })),
            usable.len,
            usable.wid,
            plan.settings.kerf,
          )
        : [],
    [layout, usable, plan.settings.kerf],
  )

  const partColorIdx = useMemo(
    () => sheetPartColors(layout?.placements.map((p) => p.partId) ?? []),
    [layout],
  )

  if (!layout) return null

  const viewW = usable.len
  const viewH = usable.wid

  const onWheel = (e: React.WheelEvent) => {
    if (!detail) return
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
    setScale((s) => Math.min(6, Math.max(0.5, s * factor)))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (!detail) return
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y }
    movedRef.current = false
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!detail || !dragRef.current) return
    if (!movedRef.current) {
      const dx = e.clientX - dragRef.current.sx
      const dy = e.clientY - dragRef.current.sy
      if (dx * dx + dy * dy > 9) movedRef.current = true
    }
    setPan({
      x: dragRef.current.px + (e.clientX - dragRef.current.sx),
      y: dragRef.current.py + (e.clientY - dragRef.current.sy),
    })
  }

  const onPointerUp = () => {
    dragRef.current = null
  }

  return (
    <svg
      className="cut-diagram"
      viewBox={`0 0 ${viewW} ${viewH}`}
      style={{
        touchAction: detail ? 'none' : undefined,
        background: 'var(--surface)',
        borderRadius: 8,
        cursor: detail ? 'grab' : 'default',
      }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      // 空白处点击：不拦截（冒泡至工作区根 → 清空选中）；拖拽平移（有位移）抑制冒泡，不清空
      onClick={(e) => {
        if (movedRef.current) e.stopPropagation()
      }}
      role="img"
      aria-label={`sheet ${sheetIndex + 1}`}
    >
      <g transform={detail ? `translate(${pan.x} ${pan.y}) scale(${scale})` : undefined}>
        {/* 零件填充渐变：每色一个垂直渐变（上亮下暗 ±GRAD_AMT），objectBoundingBox 单位按零件自适应 */}
        <defs>
          {PART_PALETTE.map((c, i) => (
            <linearGradient key={i} id={`${gradPrefix}-g${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={shadeHex(c, GRAD_AMT)} />
              <stop offset="100%" stopColor={shadeHex(c, -GRAD_AMT)} />
            </linearGradient>
          ))}
        </defs>
        {/* 板材边框 */}
        <rect x={0} y={0} width={viewW} height={viewH} fill="none" stroke="var(--text-secondary)" strokeWidth={2} />

        {/* 余料区：真实条带半透明灰，不抢零件视觉 */}
        {wasteRegions.map((r, i) =>
          r.strips.map((s, j) => (
            <rect key={`${i}-${j}`} x={s.x} y={s.y} width={s.w} height={s.h} fill={WASTE_FILL} />
          )),
        )}

        {/* 零件 */}
        {layout.placements.map((p, i) => {
          const key = partKey(p.partId, p.instance)
          const selected = props.selectedKey === key
          // 变暗源单一：悬停优先（最新意图），无悬停时回退选中。
          // 避免两套源叠加导致多板卡同时变暗；目标零件本身永不变暗。
          const focusKey = props.hoverKey ?? props.selectedKey
          const focusInSheet =
            focusKey != null &&
            layout.placements.some((pl) => partKey(pl.partId, pl.instance) === focusKey)
          const dimmed = focusInSheet && key !== focusKey
          const name = props.partNameOf?.(p.partId) ?? p.partId
          const area = p.len * p.wid
          /** 能放下名称文字的零件：中心标注一行 = 零件名称（字号自适应，加大突出） */
          const showLabel = area > 40_000
          const nameFont = Math.min(24, p.wid / 5, p.len / 10)
          /** 白 halo：保证深色标注字在淡彩零件上清晰可读（paint-order 描边在下） */
          const haloStyle: React.CSSProperties = {
            pointerEvents: 'none',
            paintOrder: 'stroke',
            stroke: 'rgba(255,255,255,0.92)',
            strokeLinejoin: 'round',
          }
          // ---- 内侧尺寸标注：长边内侧标长度（顶部居中）、短边内侧标宽度（左侧竖直旋转 -90°） ----
          // 数字恒在零件内部、距边 DIM_INSET，永不与相邻零件/余料干扰；长短边同字号、位置对称；
          // 字号自适应（上限 26）：按数字字符数限制宽度不超零件长边，按 wid/4.2 限制高度不压中心名称
          const lenStr = formatLength(p.len, unit)
          const widStr = formatLength(p.wid, unit)
          const lenChars = lenStr.length
          const dimFont = Math.max(11, Math.min(26, p.len / (lenChars * 0.55), p.wid / 4.2))
          /** 尺寸标注文字：白 halo + 深灰字，在淡彩零件内部清晰可读（halo 随字号缩放） */
          const dimHaloStyle: React.CSSProperties = {
            pointerEvents: 'none',
            paintOrder: 'stroke',
            stroke: 'rgba(255,255,255,0.92)',
            strokeWidth: Math.max(1.8, dimFont / 8),
            strokeLinejoin: 'round',
            fontWeight: 500,
          }
          const lenDimX = p.x + p.len / 2
          const lenDimY = p.y + dimFont + DIM_INSET
          const widDimX = p.x + dimFont + DIM_INSET
          const widDimY = p.y + p.wid / 2
          /** 宽度数字与长度数字包围盒是否重叠（1mm 容差）：重叠则只标长度，省略宽度 */
          const dimW = lenChars * 0.55 * dimFont
          const lenX0 = lenDimX - dimW / 2
          const lenX1 = lenDimX + dimW / 2
          const lenY0 = p.y + DIM_INSET
          const lenY1 = p.y + DIM_INSET + dimFont
          const widX0 = widDimX
          const widX1 = widDimX + dimFont
          const widY0 = widDimY - dimW / 2
          const widY1 = widDimY + dimW / 2
          const showWidDim = !(lenX0 < widX1 + 1 && lenX1 + 1 > widX0 && lenY0 < widY1 + 1 && lenY1 + 1 > widY0)
          return (
            <g
              key={key}
              className="part-rect"
              style={{ cursor: interactive ? 'pointer' : 'default' }}
              onPointerEnter={() => interactive && props.onHover?.(key)}
              onPointerLeave={() => interactive && props.onHover?.(null)}
              onClick={(e) => {
                if (!interactive) return
                e.stopPropagation()
                props.onSelect?.(selected ? null : key)
              }}
            >
              <rect
                x={p.x}
                y={p.y}
                width={p.len}
                height={p.wid}
                rx={Math.min(2, p.len / 3, p.wid / 3)}
                fill={`url(#${gradPrefix}-g${partColorIdx[i] % PART_PALETTE.length})`}
                stroke={selected ? 'var(--accent)' : '#111'}
                strokeWidth={selected ? 2.5 : 1.2}
                vectorEffect="non-scaling-stroke"
                className={dimmed ? 'part-rect dimmed' : undefined}
                opacity={selected ? 0.95 : 1}
              />
              {showLabel && (
                <text
                  x={p.x + p.len / 2}
                  y={p.y + p.wid / 2 + nameFont / 3}
                  textAnchor="middle"
                  fontSize={nameFont}
                  fill="rgba(40,40,46,0.92)"
                  style={{ ...haloStyle, fontWeight: 600, strokeWidth: Math.max(1.5, nameFont / 8) }}
                >
                  {name}
                </text>
              )}
              {/* 内侧尺寸标注：长边内侧标长度（顶部居中），短边内侧标宽度（左侧竖直旋转 -90°）；数字恒在零件内、距边 DIM_INSET */}
              <g pointerEvents="none">
                <text
                  x={lenDimX}
                  y={lenDimY}
                  textAnchor="middle"
                  fontSize={dimFont}
                  fill="#52525B"
                  style={dimHaloStyle}
                >
                  {lenStr}
                </text>
                {showWidDim && (
                  <text
                    x={widDimX}
                    y={widDimY}
                    textAnchor="middle"
                    fontSize={dimFont}
                    fill="#52525B"
                    style={dimHaloStyle}
                    transform={`rotate(-90 ${widDimX} ${widDimY})`}
                  >
                    {widStr}
                  </text>
                )}
              </g>
            </g>
          )
        })}
      </g>
    </svg>
  )
}
