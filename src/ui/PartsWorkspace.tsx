/**
 * 左栏 · 零件清单面板（UI-DESIGN.md §6.2 v1.2 方向 D）——
 * 标题行（零件清单 + 计数 + ⋯ 菜单）+ Excel 式网格表格：
 * antd Table bordered + sticky（灰底冻结表头）+ 行号列 + 数字右对齐 + 单元格即输入框（行高 ~26px）。
 * 历史方案模式（planIsHistory）：显示历史零件快照（只读网格，无 ⋯ 菜单，标题旁「历史方案」标记）。
 */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App as AntApp, Button, Checkbox, Dropdown, Input, InputNumber, Modal, Popconfirm, Select, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { MenuProps } from 'antd'
import type { TdHTMLAttributes } from 'react'
import { handleGridKeyDown } from './gridKeyboard'
import {
  CameraOutlined,
  DeleteOutlined,
  EllipsisOutlined,
  ExportOutlined,
  FileAddOutlined,
  ImportOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import { usePlanStore } from '../features/cutting/planStore'
import { useProjectStore } from '../features/projects/projectStore'
import { serializePartsCsv, parsePartsCsv, decodeCsvText } from '../features/projects/partCsv'
import { useAuthStore } from '../features/licensing/authStore'
import { useReviewStore } from '../features/recognition/reviewStore'
import { platform } from '../infra/platform'
import type { Part, SheetSpec } from '../domain/types'
import { qty } from '../domain/types'
import { toMm } from '../domain/units'

let partSeq = 0

export function PartsWorkspace() {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const current = useProjectStore((s) => s.current)
  const updateParts = useProjectStore((s) => s.updateParts)
  const addPart = useProjectStore((s) => s.addPart)
  const planIsHistory = usePlanStore((s) => s.planIsHistory)
  const planParts = usePlanStore((s) => s.planParts)
  const plan = usePlanStore((s) => s.plan)

  // Excel 式键盘漫游：方向键移动焦点、末行 ↓ 新增一行（只读历史模式禁用）
  const gridRef = useRef<HTMLDivElement>(null)
  const KEY_COLS = ['name', 'length', 'width', 'quantity', 'grain', 'sheetId', 'edgeBand', 'remove']
  const cellData = (row: number | undefined, col: string) =>
    ({ 'data-cell': '', 'data-row': row ?? 0, 'data-col': col }) as TdHTMLAttributes<HTMLTableCellElement>
  const onGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (readonly) return
    handleGridKeyDown(e, gridRef, KEY_COLS, parts.length, onAddPart)
  }

  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importRows, setImportRows] = useState<Part[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  // 历史方案：展示排样快照（只读）；普通模式：当前项目零件（可编辑）
  const readonly = planIsHistory
  const parts = readonly ? (planParts ?? []) : (current?.parts ?? [])
  const totalQuantity = parts.reduce((s, p) => s + p.quantity, 0)
  // 板材名解析：历史用方案快照的 sheetLibrary，普通用当前项目板材库
  const sheetOptions: SheetSpec[] = readonly
    ? (plan?.sheetLibrary ?? [])
    : (current?.sheets ?? [])

  const sheetNameOf = (id: string | undefined): string =>
    id ? sheetOptions.find((s) => s.id === id)?.name ?? id : t('leftPanel.anySheet')

  const patch = (id: string, patch: Partial<Part>) => {
    updateParts(parts.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }

  const onAddPart = () => {
    // 长/宽留空（0 = 未填），避免默认值误导
    addPart({
      id: `part-${Date.now()}-${partSeq++}`,
      name: '',
      length: 0,
      width: 0,
      quantity: qty(1),
      grain: 'alongLength',
    })
  }

  const onExport = () => {
    const sheetNameOfCurrent = (id: string) => current?.sheets.find((s) => s.id === id)?.name
    const csv = serializePartsCsv(parts, sheetNameOfCurrent)
    const bytes = new TextEncoder().encode(csv)
    const date = new Date().toISOString().slice(0, 10)
    void platform.saveFile(bytes, `${current?.name ?? 'project'}-${t('leftPanel.exportPartsFileName')}-${date}.csv`, 'text/csv')
  }

  const onImportFile = async (file: File) => {
    const text = decodeCsvText(await file.arrayBuffer())
    const sheetIdOf = (name: string) => current?.sheets.find((s) => s.name === name)?.id
    const rows = parsePartsCsv(text, sheetIdOf)
    if (rows.length === 0) {
      message.warning(t('leftPanel.importPartsResult', { count: 0 }))
      return
    }
    setImportRows(
      rows.map((r) => ({
        id: `part-${Date.now()}-${partSeq++}`,
        name: r.name,
        length: r.length,
        width: r.width,
        quantity: r.quantity,
        grain: r.grain,
        sheetId: r.sheetId,
        edgeBand: r.edgeBand,
      })),
    )
    setImportOpen(true)
  }

  const onImportApply = () => {
    updateParts(importRows)
    message.success(t('leftPanel.importPartsResult', { count: importRows.length }))
    setImportOpen(false)
    setImportRows([])
  }

  const onBulkApply = () => {
    const lines = bulkText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    const parsed: Part[] = []
    for (const line of lines) {
      const m = line.match(/^(\S+)\s+([\d.]+)\s+([\d.]+)(?:\s+([\d.]+))?$/)
      if (!m) continue
      const [, name, length, width, qtyText] = m
      if (!name) continue // 正则组 1 必匹配，此处仅为 TS 收窄
      const l = Math.round(Number(length))
      const w = Math.round(Number(width))
      if (!Number.isFinite(l) || !Number.isFinite(w) || l < 1 || w < 1) continue
      parsed.push({
        id: `part-${Date.now()}-${partSeq++}`,
        name,
        length: l,
        width: w,
        quantity: qtyText ? qty(Number(qtyText)) : qty(1),
      })
    }
    if (parsed.length === 0) {
      message.warning(t('leftPanel.bulkPasteResult', { count: 0 }))
      return
    }
    updateParts([...parts, ...parsed])
    message.success(t('leftPanel.bulkPasteResult', { count: parsed.length }))
    setBulkText('')
    setBulkOpen(false)
  }

  const onBulkRotation = (grain: 'alongLength' | 'any') => {
    if (parts.length === 0) return
    updateParts(parts.map((p) => ({ ...p, grain })))
    message.success(t('leftPanel.bulkRotationResult', { count: parts.length }))
  }

  /** 旋转列全选态：全部可旋转 / 全部不可旋转 / 混合 */
  const anyCount = parts.filter((p) => p.grain === 'any').length
  const allRotatable = parts.length > 0 && anyCount === parts.length
  const mixedRotation = anyCount > 0 && anyCount < parts.length

  /** 数字列表头：左对齐（与单元格内容对齐） */
  const numTitle = (label: string) => <span style={{ display: 'block', textAlign: 'left' }}>{label}</span>

  /** 只读文本单元格 */
  const cellText = (v: React.ReactNode) => <span className="cell-text">{v}</span>

  const columns: ColumnsType<Part> = [
    {
      title: '#',
      key: 'row',
      width: 24,
      onCell: (_v, index) => ({ ...cellData(index, 'row'), className: 'row-num-cell' }),
      render: (_v, _r, index) => (
        <span style={{ color: 'var(--text-disabled)', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
          {index + 1}
        </span>
      ),
    },
    {
      title: t('leftPanel.name'),
      dataIndex: 'name',
      key: 'name',
      width: 120,
      onCell: (_v, index) => cellData(index, 'name'),
      render: (v: string, r) =>
        readonly ? (
          cellText(v || '—')
        ) : (
          <Input
            size="small"
            variant="borderless"
            className="name-input"
            value={v}
            placeholder={t('leftPanel.name')}
            onChange={(e) => patch(r.id, { name: e.target.value })}
          />
        ),
    },
    {
      title: numTitle(t('leftPanel.length')),
      dataIndex: 'length',
      key: 'length',
      width: 60,
      onCell: (_v, index) => cellData(index, 'length'),
      render: (v: number, r) =>
        readonly ? (
          cellText(v > 0 ? v : '—')
        ) : (
          <InputNumber
            size="small"
            variant="borderless"
            min={0}
            controls={false}
            value={v === 0 ? undefined : v}
            placeholder="0"
            style={{ width: '100%' }}
            onChange={(x) => patch(r.id, { length: toMm(x ?? 0, 'mm') })}
          />
        ),
    },
    {
      title: numTitle(t('leftPanel.width')),
      dataIndex: 'width',
      key: 'width',
      width: 60,
      onCell: (_v, index) => cellData(index, 'width'),
      render: (v: number, r) =>
        readonly ? (
          cellText(v > 0 ? v : '—')
        ) : (
          <InputNumber
            size="small"
            variant="borderless"
            min={0}
            controls={false}
            value={v === 0 ? undefined : v}
            placeholder="0"
            style={{ width: '100%' }}
            onChange={(x) => patch(r.id, { width: toMm(x ?? 0, 'mm') })}
          />
        ),
    },
    {
      title: t('leftPanel.quantity'),
      dataIndex: 'quantity',
      key: 'quantity',
      width: 48,
      onCell: (_v, index) => cellData(index, 'quantity'),
      render: (v: number, r) =>
        readonly ? (
          cellText(v)
        ) : (
          <InputNumber
            size="small"
            variant="borderless"
            min={0}
            step={1}
            controls={false}
            value={v}
            style={{ width: '100%' }}
            onChange={(x) => patch(r.id, { quantity: qty(x ?? 0) })}
          />
        ),
    },
    {
      title: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {t('leftPanel.rotation')}
          {!readonly && (
            <Checkbox
              checked={allRotatable}
              indeterminate={mixedRotation}
              onChange={(e) => onBulkRotation(e.target.checked ? 'any' : 'alongLength')}
              aria-label={t('leftPanel.rotationBulk')}
            />
          )}
        </div>
      ),
      dataIndex: 'grain',
      key: 'grain',
      width: 44,
      onCell: (_v, index) => cellData(index, 'grain'),
      render: (v: 'alongLength' | 'any' | undefined, r) =>
        readonly ? (
          cellText(v === 'any' ? '✓' : '')
        ) : (
          <Tooltip title={t('leftPanel.rotationHint')}>
            <Checkbox
              checked={v === 'any'}
              onChange={(e) => patch(r.id, { grain: e.target.checked ? 'any' : 'alongLength' })}
              aria-label={t('leftPanel.rotation')}
            />
          </Tooltip>
        ),
    },
    {
      title: t('leftPanel.partSheet'),
      dataIndex: 'sheetId',
      key: 'sheetId',
      width: 76,
      onCell: (_v, index) => cellData(index, 'sheetId'),
      render: (v: string | undefined, r) =>
        readonly ? (
          cellText(sheetNameOf(v))
        ) : (
          <Select
            size="small"
            variant="borderless"
            value={v}
            placeholder={t('leftPanel.anySheet')}
            style={{ width: '100%' }}
            options={sheetOptions.map((s) => ({ value: s.id, label: s.name }))}
            onChange={(id) => patch(r.id, { sheetId: id })}
          />
        ),
    },
    {
      title: t('leftPanel.edgeBand'),
      dataIndex: 'edgeBand',
      key: 'edgeBand',
      width: 64,
      onCell: (_v, index) => cellData(index, 'edgeBand'),
      render: (v: ('L' | 'R' | 'T' | 'B')[] | undefined, r) =>
        readonly ? (
          cellText((v ?? []).join('/') || '—')
        ) : (
          <Select
            size="small"
            variant="borderless"
            mode="multiple"
            value={v ?? []}
            style={{ width: '100%' }}
            maxTagCount="responsive"
            options={[
              { value: 'L', label: 'L' },
              { value: 'R', label: 'R' },
              { value: 'T', label: 'T' },
              { value: 'B', label: 'B' },
            ]}
            onChange={(x: ('L' | 'R' | 'T' | 'B')[]) => patch(r.id, { edgeBand: x })}
          />
        ),
    },
    {
      title: '',
      key: 'actions',
      width: 32,
      onCell: (_v, index) => cellData(index, 'remove'),
      render: (_, r) =>
        readonly ? null : (
          <Popconfirm
            title={t('leftPanel.confirmRemovePart', { name: r.name })}
            okText={t('common.delete')}
            cancelText={t('common.cancel')}
            onConfirm={() => useProjectStore.getState().removePart(r.id)}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label={t('leftPanel.remove')} />
          </Popconfirm>
        ),
    },
  ]

  /** ⋯ 菜单：原工具行 5 操作收进菜单（不占表格高度） */
  const menuItems: MenuProps['items'] = [
    { key: 'add', icon: <PlusOutlined />, label: t('leftPanel.addPart'), onClick: onAddPart },
    { key: 'bulk', icon: <FileAddOutlined />, label: t('leftPanel.bulkPaste'), onClick: () => setBulkOpen(true) },
    {
      key: 'ai',
      icon: <CameraOutlined />,
      label: t('leftPanel.aiRecognition'),
      onClick: () =>
        useAuthStore.getState().status.state === 'loggedIn'
          ? useReviewStore.getState().open()
          : useReviewStore.getState().requireLogin(),
    },
    { key: 'import', icon: <ImportOutlined />, label: t('leftPanel.importParts'), onClick: () => fileRef.current?.click() },
    { key: 'export', icon: <ExportOutlined />, label: t('leftPanel.exportParts'), onClick: onExport },
  ]

  return (
    <div className="parts-panel">
      {/* 标题行：零件清单 + 计数 + ⋯ 菜单 */}
      <div className="parts-header">
        <span className="panel-title">{t('leftPanel.partsList')}</span>
        {readonly && <Tag color="warning" style={{ marginInlineEnd: 0 }}>{t('leftPanel.history')}</Tag>}
        {!readonly && (
          <span className="panel-sub">{t('leftPanel.partsCount', { count: parts.length, total: totalQuantity })}</span>
        )}
        <div style={{ flex: 1 }} />
        {!readonly && (
          <Dropdown menu={{ items: menuItems }} trigger={['click']}>
            <Button type="text" size="small" icon={<EllipsisOutlined />} aria-label={t('leftPanel.partsList')} />
          </Dropdown>
        )}
      </div>

      {/* Excel 式网格表格 */}
      <div className="parts-table-wrap" ref={gridRef} onKeyDownCapture={onGridKeyDown}>
        <Table<Part>
          className="parts-table"
          size="small"
          rowKey="id"
          columns={columns}
          dataSource={parts}
          pagination={false}
          bordered
          locale={{ emptyText: t('leftPanel.partsEmpty') }}
        />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,.txt,text/csv,text/plain"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void onImportFile(f)
          e.target.value = ''
        }}
      />

      <Modal
        open={bulkOpen}
        title={t('leftPanel.bulkPaste')}
        onCancel={() => setBulkOpen(false)}
        onOk={onBulkApply}
        okText={t('leftPanel.bulkPasteApply')}
        cancelText={t('common.cancel')}
      >
        <Input.TextArea
          rows={8}
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          placeholder={t('leftPanel.bulkPastePlaceholder')}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </Modal>

      <Modal
        open={importOpen}
        title={t('leftPanel.importParts')}
        onCancel={() => {
          setImportOpen(false)
          setImportRows([])
        }}
        onOk={onImportApply}
        okText={t('leftPanel.importPartsApply')}
        cancelText={t('common.cancel')}
      >
        <div style={{ fontSize: 13 }}>
          {t('leftPanel.importPartsConfirm', { count: importRows.length, total: parts.length })}
        </div>
      </Modal>
    </div>
  )
}
