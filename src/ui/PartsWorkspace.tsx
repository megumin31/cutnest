/**
 * 中央 · 零件工作区（编辑态主角，UI-DESIGN.md §6.2 v1.1）——
 * 工具行（添加/批量粘贴）+ 全宽行内编辑表格（无横向滚动）。
 */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App as AntApp, Button, Checkbox, Input, InputNumber, Modal, Popconfirm, Select, Table, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CameraOutlined, DeleteOutlined, ExportOutlined, FileAddOutlined, ImportOutlined, PlusOutlined } from '@ant-design/icons'
import { useProjectStore } from '../features/projects/projectStore'
import { serializePartsCsv, parsePartsCsv, decodeCsvText } from '../features/projects/partCsv'
import { useAuthStore } from '../features/licensing/authStore'
import { useReviewStore } from '../features/recognition/reviewStore'
import { platform } from '../infra/platform'
import type { Part } from '../domain/types'
import { qty } from '../domain/types'
import { toMm } from '../domain/units'

let partSeq = 0

export function PartsWorkspace() {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const current = useProjectStore((s) => s.current)
  const updateParts = useProjectStore((s) => s.updateParts)
  const addPart = useProjectStore((s) => s.addPart)

  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importRows, setImportRows] = useState<Part[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const parts = current?.parts ?? []
  const totalQuantity = parts.reduce((s, p) => s + p.quantity, 0)

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
    const sheetNameOf = (id: string) => current?.sheets.find((s) => s.id === id)?.name
    const csv = serializePartsCsv(parts, sheetNameOf)
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

  /** 数字列表头：左对齐并补偿 InputNumber(small) 左侧内边距（antd paddingInlineSM=7px），使表头文字与数字左缘重合 */
  const numTitle = (label: string) => (
    <span style={{ display: 'block', textAlign: 'left', paddingLeft: 7 }}>{label}</span>
  )

  const columns: ColumnsType<Part> = [
    {
      title: t('leftPanel.name'),
      dataIndex: 'name',
      key: 'name',
      width: 160,
      render: (v: string, r) => (
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
      width: 84,
      render: (v: number, r) => (
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
      width: 84,
      render: (v: number, r) => (
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
      title: <span style={{ display: 'block', textAlign: 'center' }}>{t('leftPanel.quantity')}</span>,
      dataIndex: 'quantity',
      key: 'quantity',
      width: 76,
      align: 'center',
      render: (v: number, r) => (
        <InputNumber
          size="small"
          variant="borderless"
          min={0}
          step={1}
          controls={false}
          className="num-center"
          value={v}
          style={{ width: '100%' }}
          onChange={(x) => patch(r.id, { quantity: qty(x ?? 0) })}
        />
      ),
    },
    {
      title: (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
          {t('leftPanel.rotation')}
          <Checkbox
            checked={allRotatable}
            indeterminate={mixedRotation}
            onChange={(e) => onBulkRotation(e.target.checked ? 'any' : 'alongLength')}
            aria-label={t('leftPanel.rotationBulk')}
          />
        </div>
      ),
      dataIndex: 'grain',
      key: 'grain',
      width: 90,
      align: 'center',
      render: (v: 'alongLength' | 'any' | undefined, r) => (
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
      width: 110,
      render: (v: string | undefined, r) => (
        <Select
          size="small"
          variant="borderless"
          value={v}
          placeholder={t('leftPanel.anySheet')}
          style={{ width: '100%' }}
          options={(current?.sheets ?? []).map((s) => ({ value: s.id, label: s.name }))}
          onChange={(id) => patch(r.id, { sheetId: id })}
        />
      ),
    },
    {
      title: t('leftPanel.edgeBand'),
      dataIndex: 'edgeBand',
      key: 'edgeBand',
      width: 150,
      render: (v: ('L' | 'R' | 'T' | 'B')[] | undefined, r) => (
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
      width: 52,
      render: (_, r) => (
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 工具行 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 12,
          flexShrink: 0,
        }}
      >
        <Button icon={<PlusOutlined />} onClick={onAddPart}>
          {t('leftPanel.addPart')}
        </Button>
        <Button icon={<FileAddOutlined />} onClick={() => setBulkOpen(true)}>
          {t('leftPanel.bulkPaste')}
        </Button>
        <Button
          icon={<CameraOutlined />}
          onClick={() =>
            useAuthStore.getState().status.state === 'loggedIn'
              ? useReviewStore.getState().open()
              : useReviewStore.getState().requireLogin()
          }
        >
          {t('leftPanel.aiRecognition')}
        </Button>
        <Button icon={<ImportOutlined />} onClick={() => fileRef.current?.click()}>
          {t('leftPanel.importParts')}
        </Button>
        <Button icon={<ExportOutlined />} onClick={onExport}>
          {t('leftPanel.exportParts')}
        </Button>
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
        <div style={{ flex: 1 }} />
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          {t('leftPanel.partsCount', { count: parts.length, total: totalQuantity })}
        </Typography.Text>
      </div>

      {/* 全宽表格 */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <Table<Part>
          size="small"
          rowKey="id"
          columns={columns}
          dataSource={parts}
          pagination={false}
          scroll={{ x: 806, y: 'calc(100% - 8px)' }}
          locale={{ emptyText: t('leftPanel.partsEmpty') }}
        />
      </div>

      {/* 提示条 */}
      <div
        style={{
          flexShrink: 0,
          marginTop: 10,
          fontSize: 12,
          color: 'var(--text-secondary)',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '6px 12px',
        }}
      >
        💡 {t('guide.step1Hint')} → {t('guide.step2Hint')} → {t('guide.step3Hint')}
      </div>

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
