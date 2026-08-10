/**
 * 切割图可视化（视觉主角，UI-DESIGN.md §7）——
 * 零件矩形填充零件色、圆角 2px、描边 1px；余料区半透明灰；悬停高亮 + 点击选中（强调色描边）。
 * 支持卡片模式（自适应）与单板大图模式（缩放/平移）。
 */
import { useMemo, useRef, useState } from 'react'
import type { CutPlan, SheetSpec } from '../domain/types'
import { usableArea } from '../domain/optimizer'
import { wasteRegionsOfLayout } from '../domain/optimizer/evaluate'
import { PART_PALETTE, sheetPartColors } from '../domain/palette'
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

const WASTE_FILL = 'rgba(127,127,127,0.35)'

export function CutDiagram(props: CutDiagramProps) {
  const { plan, sheet, sheetIndex, unit, interactive = true, detail = false } = props
  const layout = plan.sheets[sheetIndex]
  const usable = useMemo(() => usableArea(sheet, plan.settings), [sheet, plan.settings])

  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null)

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
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!detail || !dragRef.current) return
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
      role="img"
      aria-label={`sheet ${sheetIndex + 1}`}
    >
      <g transform={detail ? `translate(${pan.x} ${pan.y}) scale(${scale})` : undefined}>
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
          const hovered = props.hoverKey === key
          const dimmed =
            (props.selectedKey !== null && props.selectedKey !== undefined && !selected) ||
            (props.hoverKey !== null && props.hoverKey !== undefined && !hovered)
          const color = PART_PALETTE[partColorIdx[i] % PART_PALETTE.length]
          const name = props.partNameOf?.(p.partId) ?? p.partId
          const area = p.len * p.wid
          /** 能放下两行文字的零件：名称 + 尺寸（字号自适应） */
          const showLabel = area > 40_000
          const nameFont = Math.min(20, p.wid / 6, p.len / 14)
          const dimFont = Math.min(15, p.wid / 8, p.len / 18)
          /** 深色描边 halo：保证白字在任何零件色上可读（paint-order 描边在下） */
          const haloStyle: React.CSSProperties = {
            pointerEvents: 'none',
            paintOrder: 'stroke',
            stroke: 'rgba(24,24,27,0.65)',
            strokeLinejoin: 'round',
          }
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
                fill={color}
                stroke={selected ? 'var(--accent)' : 'rgba(24,24,27,0.75)'}
                strokeWidth={selected ? 2.5 : 1}
                className={dimmed ? 'part-rect dimmed' : undefined}
                opacity={selected ? 0.95 : 1}
              />
              {showLabel && (
                <>
                  <text
                    x={p.x + p.len / 2}
                    y={p.y + p.wid / 2 - (p.wid > 46 ? 2 : 0)}
                    textAnchor="middle"
                    fontSize={nameFont}
                    fill="rgba(255,255,255,0.95)"
                    style={{ ...haloStyle, fontWeight: 500, strokeWidth: Math.max(1.5, nameFont / 8) }}
                  >
                    {name}
                  </text>
                  <text
                    x={p.x + p.len / 2}
                    y={p.y + p.wid / 2 + 14}
                    textAnchor="middle"
                    fontSize={dimFont}
                    fill="rgba(255,255,255,0.9)"
                    style={{ ...haloStyle, strokeWidth: Math.max(1.2, dimFont / 8) }}
                  >
                    {formatLength(p.len, unit)}×{formatLength(p.wid, unit)}
                  </text>
                </>
              )}
            </g>
          )
        })}
      </g>
    </svg>
  )
}
