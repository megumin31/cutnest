/**
 * 历史方案 · 零件清单 —— 只读表格（历史查看模式中央区，UI-DESIGN §6.2 扩展）：
 * 展示排样时的完整零件表快照（名称/尺寸/数量/旋转/封边/指定板材）。
 * 旧数据无 parts 快照时退化为名字列表（partNames），缺字段显示占位符。
 */
import { useTranslation } from 'react-i18next'
import { Empty, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { Part, SheetSpec } from '../domain/types'

export interface HistoryPartListProps {
  parts: Part[] | null
  partNames: Record<string, string> | null
  sheetLibrary: SheetSpec[]
}

interface Row {
  name: string
  length: string
  width: string
  quantity: string
  rotatable: string
  edgeBand: string
  sheet: string
}

export function HistoryPartList({ parts, partNames, sheetLibrary }: HistoryPartListProps) {
  const { t } = useTranslation()

  const sheetNameOf = (id: string | undefined): string =>
    id ? sheetLibrary.find((s) => s.id === id)?.name ?? id : t('leftPanel.anySheet')

  const rows: Row[] = parts
    ? parts.map((p) => ({
        name: p.name,
        length: p.length > 0 ? String(p.length) : '—',
        width: p.width > 0 ? String(p.width) : '—',
        quantity: String(p.quantity),
        rotatable: p.grain === 'any' ? t('common.yes') : t('common.no'),
        edgeBand: (p.edgeBand ?? []).join(' / ') || '—',
        sheet: sheetNameOf(p.sheetId),
      }))
    : partNames
      ? Object.entries(partNames).map(([, name]) => ({
          name,
          length: '—',
          width: '—',
          quantity: '—',
          rotatable: '—',
          edgeBand: '—',
          sheet: '—',
        }))
      : []

  const columns: ColumnsType<Row> = [
    { title: t('leftPanel.name'), dataIndex: 'name', key: 'name', width: 160 },
    { title: t('leftPanel.length'), dataIndex: 'length', key: 'length', width: 90, align: 'right' },
    { title: t('leftPanel.width'), dataIndex: 'width', key: 'width', width: 90, align: 'right' },
    { title: t('leftPanel.quantity'), dataIndex: 'quantity', key: 'quantity', width: 80, align: 'center' },
    { title: t('leftPanel.rotation'), dataIndex: 'rotatable', key: 'rotatable', width: 90, align: 'center' },
    { title: t('leftPanel.edgeBand'), dataIndex: 'edgeBand', key: 'edgeBand', width: 110 },
    { title: t('leftPanel.partSheet'), dataIndex: 'sheet', key: 'sheet', width: 120 },
  ]

  if (rows.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('leftPanel.partsEmpty')} style={{ marginTop: 60 }} />
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12 }}>
        {t('leftPanel.partsList')}
      </div>
      <Table<Row>
        size="small"
        rowKey={(r, i) => `${r.name}-${i}`}
        columns={columns}
        dataSource={rows}
        pagination={false}
        scroll={{ y: 'calc(100vh - 320px)' }}
      />
    </div>
  )
}
