/**
 * 左栏 · 历史方案（折叠收起）—— 按项目分组：日期/板材数/利用率/成本；
 * 操作：重新打开只读查看 + 重新导出 PDF/DXF、删除；每项目保留最近 50 条。
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App as AntApp, Button, Dropdown, Empty, Modal } from 'antd'
import { DeleteOutlined, ExportOutlined, EyeOutlined } from '@ant-design/icons'
import { storage } from '../infra/storage'
import { useProjectStore } from '../features/projects/projectStore'
import { usePlanStore } from '../features/cutting/planStore'
import { useAuthStore } from '../features/licensing/authStore'
import { useSettingsStore } from '../features/settings/settingsStore'
import { exportPdf, exportDxf, partNamesOf } from './exportActions'
import type { PlanRecord } from '../domain/types'

export function HistoryPanel() {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const current = useProjectStore((s) => s.current)
  const auth = useAuthStore((s) => s.status)
  const exportLang = useSettingsStore((s) => s.settings.exportLang)

  const [records, setRecords] = useState<PlanRecord[]>([])
  const [collapsed, setCollapsed] = useState(true)
  const [deleting, setDeleting] = useState<PlanRecord | null>(null)

  const load = async () => {
    if (!current) return
    const list = await storage.listPlans(current.id)
    setRecords(list)
  }

  useEffect(() => {
    if (!collapsed && current) void load()
  }, [collapsed, current])

  // 计算完成后刷新
  useEffect(() => {
    const unsub = usePlanStore.subscribe((s, prev) => {
      if (s.status === 'done' && prev.status !== 'done') void load()
    })
    return unsub
  }, [current])

  if (!current) return null

  const onOpen = (r: PlanRecord) => {
    usePlanStore.getState().setPlan(r.plan)
    usePlanStore.getState().setStatus('done')
    usePlanStore.getState().setSheetIndex(0)
  }

  const onExport = async (r: PlanRecord, kind: 'pdf' | 'dxf') => {
    const project = { ...current, sheets: r.sheets, exportPrefs: current.exportPrefs }
    // 零件名用排样时快照（零件表可能已改），缺快照才回退当前项目
    const names = r.partNames
      ? new Map(Object.entries(r.partNames))
      : partNamesOf(current)
    try {
      if (kind === 'pdf') {
        await exportPdf(project, r.plan, auth, exportLang, names)
      } else {
        await exportDxf(project, r.plan, names)
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="collapse-card">
      <div className="collapse-card-header" onClick={() => setCollapsed((c) => !c)}>
        <span>{t('leftPanel.history')}</span>
        <span style={{ color: 'var(--text-disabled)', fontSize: 12 }}>{collapsed ? '▸' : '▾'}</span>
      </div>
      {!collapsed && (
        <div style={{ padding: '0 14px 14px' }}>
          {records.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('leftPanel.historyEmpty')}
              style={{ margin: '12px 0' }}
            />
          ) : (
            records.map((r) => (
              <div
                key={r.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 4px',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 13,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{new Date(r.createdAt).toLocaleString()}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                    {t('statusbar.sheets', { count: r.plan.stats.sheetCount })} ·{' '}
                    {t('statusbar.utilization', { pct: r.plan.stats.utilization.toFixed(1) })} · ¥
                    {r.plan.stats.totalCost.toFixed(0)}
                  </div>
                </div>
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: [
                      {
                        key: 'open',
                        label: t('leftPanel.historyOpen'),
                        icon: <EyeOutlined />,
                        onClick: () => onOpen(r),
                      },
                      {
                        key: 'pdf',
                        label: t('workspace.exportPdf'),
                        icon: <ExportOutlined />,
                        onClick: () => void onExport(r, 'pdf'),
                      },
                      {
                        key: 'dxf',
                        label: t('workspace.exportDxf'),
                        icon: <ExportOutlined />,
                        disabled: auth.state !== 'loggedIn' || !auth.paid,
                        onClick: () => void onExport(r, 'dxf'),
                      },
                      {
                        key: 'delete',
                        label: t('leftPanel.historyDelete'),
                        icon: <DeleteOutlined />,
                        danger: true,
                        onClick: () => setDeleting(r),
                      },
                    ],
                  }}
                >
                  <Button type="text" size="small">
                    ⋯
                  </Button>
                </Dropdown>
              </div>
            ))
          )}
        </div>
      )}
      <Modal
        open={!!deleting}
        title={t('leftPanel.historyDelete')}
        okText={t('common.delete')}
        cancelText={t('common.cancel')}
        okButtonProps={{ danger: true }}
        onOk={async () => {
          if (deleting) {
            await storage.deletePlan(deleting.id)
            await load()
          }
          setDeleting(null)
        }}
        onCancel={() => setDeleting(null)}
      >
        {new Date(deleting?.createdAt ?? 0).toLocaleString()}
      </Modal>
    </div>
  )
}
