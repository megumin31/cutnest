/**
 * Excel 式键盘漫游（零件表/板材库共用，UI-DESIGN.md §6.2）——
 * 方向键在单元格间移动焦点（不触发 InputNumber 步进/Select 切换），
 * 最后一行按 ↓ = 新增一行并聚焦新行同列；Enter = 下移（末行不新增）。
 * 实现要点：容器 onKeyDownCapture（捕获阶段先于 antd 内部 bubble handler，
 * preventDefault + stopPropagation 阻断步进/选择）；Select 下拉打开时放行给下拉键控。
 */
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'

const DIRS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
}

export function handleGridKeyDown(
  e: ReactKeyboardEvent<HTMLElement>,
  wrapRef: RefObject<HTMLElement | null>,
  cols: string[],
  rowCount: number,
  addRow: (() => void) | null,
): void {
  const key = e.key
  const dir = key === 'Enter' ? DIRS.ArrowDown : DIRS[key]
  if (!dir) return

  const active = document.activeElement as HTMLElement | null
  const cell = active?.closest<HTMLElement>('[data-cell]')
  if (!cell) return
  // Select 下拉展开中：方向键留给下拉选项键控（不漫游）
  if (cell.querySelector('.ant-select-open')) return

  e.preventDefault()
  e.stopPropagation()

  const row = Number(cell.dataset.row)
  const col = cell.dataset.col ?? ''
  const colIdx = cols.indexOf(col)
  if (colIdx < 0) return

  const [dr, dc] = dir
  let nextRow = row + dr
  const nextColIdx = Math.max(0, Math.min(colIdx + dc, cols.length - 1))

  // Enter：末行不新增、不越界（与 ↓ 区分）
  if (key === 'Enter' && nextRow >= rowCount) return

  // 最后一行 ↓：新增一行，焦点落新行同列
  if (dr > 0 && nextRow >= rowCount) {
    if (!addRow) return
    addRow()
    // store 同步更新后 DOM 在下一帧就绪（离散事件同步提交）
    requestAnimationFrame(() => focusCell(wrapRef, rowCount, cols[colIdx]))
    return
  }

  nextRow = Math.max(0, Math.min(nextRow, rowCount - 1))
  focusCell(wrapRef, nextRow, cols[nextColIdx])
}

/** 聚焦指定行/列单元格内的首个可聚焦控件 */
export function focusCell(
  wrapRef: RefObject<HTMLElement | null>,
  row: number,
  col: string,
): void {
  const el = wrapRef.current?.querySelector<HTMLElement>(
    `[data-cell][data-row="${row}"][data-col="${col}"]`,
  )
  const target = el?.querySelector<HTMLElement>(
    'input, .ant-select-selector, .ant-checkbox, button',
  )
  target?.focus()
}
