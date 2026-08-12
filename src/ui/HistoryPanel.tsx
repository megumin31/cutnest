/**
 * 左栏 · 历史方案（折叠收起）—— 按项目分组：日期/板材数/利用率/成本；
 * 操作：重新打开只读查看 + 重新导出 PDF/DXF、删除；每项目保留最近 50 条。
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App as AntApp, Button, Dropdown, Empty, Modal } from 'antd'
import { DeleteOutlined, EditOutlined, ExportOutlined } from '@ant-design/icons'
import { storage } from '../infra/storage'
import { useProjectStore } from '../features/projects/projectStore'
import { usePlanStore } from '../features/cutting/planStore'
import { useAuthStore } from '../features/licensing/authStore'
import { useSettingsStore } from '../features/settings/settingsStore'
import { exportPdf, exportDxf, partNamesOf } from './exportActions'
import { continueFromHistory } from '../features/cutting/historyActions'
import type { PlanRecord } from '../domain/types'

export function HistoryPanel() {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const current = useProjectStore((s) => s.current)
  const auth = useAuthStore((s) => s.status)
  const exportLang = useSettingsStore((s) => s.settings.exportLang)
  // 落库版本号：saveToHistory 成功后自增，作为"展开时刷新 + 落库后刷新"的统一信号
  // （不能用 status==='done'：它早于 saveToHistory 写入，此时 listPlans 读不到新方案——竞态）
  const historyRev = usePlanStore((s) => s.historyRev)

  const [records, setRecords] = useState<PlanRecord[]>([])
  const [collapsed, setCollapsed] = useState(true)
  const [deleting, setDeleting] = useState<PlanRecord | null>(null)
  // 请求序号守卫：展开/落库连续触发的并发 load，只应用最后一次的结果（慢的旧请求不得覆盖新列表）
  const loadSeqRef = useRef(0)

  const load = async () => {
    if (!current) return
    const seq = ++loadSeqRef.current
    const list = await storage.listPlans(current.id)
    if (seq === loadSeqRef.current) setRecords(list)
  }

  useEffect(() => {
    if (!collapsed && current) void load()
  }, [collapsed, current, historyRev])

  if (!current) return null

  const onOpen = (r: PlanRecord) => {
    // 取消运行中的任务并作废其回调，防止其晚到的 CANCELLED/结果覆盖历史方案视图；
    // 载入方案 + 零件快照（名字/零件清单随方案，不依赖当前零件表）
    usePlanStore.getState().openHistory(r)
  }

  const onContinue = (r: PlanRecord) => {
    // 显式以目标行为参数（不依赖“当前打开了哪条方案”的隐式状态）
    if (continueFromHistory(r)) {
      message.success(t('leftPanel.historyContinueDone'))
    }
  }

  const onExport = async (r: PlanRecord, kind: 'pdf' | 'dxf') => {
    // 零件表用排样时快照（零件表可能已改）：parts 完整快照优先，缺快照回退当前项目；
    // exportPdf 的零件名与封边需求（edgeBand）均取自该零件表
    const project = { ...current, sheets: r.sheets, parts: r.parts ?? current.parts, exportPrefs: current.exportPrefs }
    const names = r.partNames
      ? new Map(Object.entries(r.partNames))
      : partNamesOf(project)
    const progressKey = 'pdf-export-progress'
    try {
      if (kind === 'pdf') {
        // 首次导出需下载字体（~17MB）：进度提示
        message.open({ key: progressKey, content: t('workspace.fontProgress', { pct: 0 }), duration: 0 })
        await exportPdf(project, r.plan, auth, exportLang, names, (p) => {
          message.open({
            key: progressKey,
            content: t('workspace.fontProgress', { pct: Math.round(p * 100) }),
            duration: 0,
          })
        })
        message.destroy(progressKey)
      } else {
        await exportDxf(project, r.plan, names)
      }
    } catch (e) {
      message.destroy(progressKey)
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
                role="button"
                tabIndex={0}
                onClick={() => onOpen(r)}
                onKeyDown={(e) => {
                  // 只响应行自身聚焦的按键；⋯ 按钮等子元素的键盘事件不激活行（防误打开）
                  if (e.target !== e.currentTarget) return
                  // role="button" 键盘契约 = Enter + Space（Space 需 preventDefault 防页面滚动）
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onOpen(r)
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 4px',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{new Date(r.createdAt).toLocaleString()}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                    {t('statusbar.sheets', { count: r.plan.stats.sheetCount })} ·{' '}
                    {t('statusbar.parts', {
                      count: r.plan.sheets.reduce((n, sh) => n + sh.placements.length, 0),
                    })}{' '}
                    · {t('statusbar.utilization', { pct: r.plan.stats.utilization.toFixed(1) })}
                  </div>
                </div>
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: [
                      {
                        key: 'continue',
                        label: t('leftPanel.historyContinue'),
                        icon: <EditOutlined />,
                        onClick: () => onContinue(r),
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
                  <Button
                    type="text"
                    size="small"
                    onClick={(e) => e.stopPropagation()}
                    aria-label={t('leftPanel.historyActions')}
                  >
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
