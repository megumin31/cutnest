/**
 * 项目列表页 —— 卡片流网格 + 搜索 + 新建（UI-DESIGN.md §6.1）。
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App as AntApp, Button, Dropdown, Empty, Input, Modal } from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { useProjectStore } from '../features/projects/projectStore'
import { useAppStore, usePlanStore } from '../features/cutting/planStore'

export function ProjectListPage() {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const projects = useProjectStore((s) => s.projects)
  const loaded = useProjectStore((s) => s.loaded)
  const loadProjects = useProjectStore((s) => s.loadProjects)
  const createProject = useProjectStore((s) => s.createProject)
  const openProject = useProjectStore((s) => s.openProject)
  const deleteProject = useProjectStore((s) => s.deleteProject)
  const navigate = useAppStore((s) => s.navigate)

  const [search, setSearch] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    if (!loaded) void loadProjects()
  }, [loaded, loadProjects])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects
  }, [projects, search])

  const onOpen = async (id: string) => {
    await openProject(id)
    usePlanStore.getState().reset()
    navigate('workspace', id)
  }

  const onCreate = async () => {
    const project = await createProject(t('projects.createDefault'))
    message.success(t('projects.created'))
    usePlanStore.getState().reset()
    navigate('workspace', project.id)
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{t('projects.title')}</h1>
        <div style={{ flex: 1 }} />
        <Input
          prefix={<SearchOutlined style={{ color: 'var(--text-disabled)' }} />}
          placeholder={t('common.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 240 }}
          allowClear
        />
      </div>

      {filtered.length === 0 && !search ? (
        <Empty description={t('projects.empty')} style={{ marginTop: 80 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => void onCreate()}>
            {t('projects.createDefault')}
          </Button>
        </Empty>
      ) : (
        <div className="project-grid">
          {filtered.map((p) => {
            const partCount = p.parts.reduce((s, x) => s + x.quantity, 0)
            const estimatedSheets = Math.max(1, Math.ceil(
              (p.parts.reduce((s, x) => s + x.length * x.width * x.quantity, 0) /
                ((p.sheets[0]?.length ?? 2440) * (p.sheets[0]?.width ?? 1220))),
            ))
            return (
              <div
                key={p.id}
                className="project-card"
                onClick={() => void onOpen(p.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    void onOpen(p.id)
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: [
                      {
                        key: 'rename',
                        label: t('projects.rename'),
                        icon: <EditOutlined />,
                        onClick: (e) => {
                          e.domEvent.stopPropagation()
                          setRenaming({ id: p.id, name: p.name })
                        },
                      },
                      {
                        key: 'delete',
                        label: t('projects.delete'),
                        icon: <DeleteOutlined />,
                        danger: true,
                        onClick: (e) => {
                          e.domEvent.stopPropagation()
                          setDeleting({ id: p.id, name: p.name })
                        },
                      },
                    ],
                  }}
                >
                  <Button
                    type="text"
                    size="small"
                    style={{ position: 'absolute', top: 10, right: 10 }}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={t('common.actions')}
                  >
                    ⋯
                  </Button>
                </Dropdown>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8, paddingRight: 32 }}>
                  {p.name}
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                  {t('projects.partCount', { count: partCount })}
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                  {t('projects.sheetCount', { count: estimatedSheets })}
                </div>
                <div style={{ color: 'var(--text-disabled)', fontSize: 12, marginTop: 12 }}>
                  {t('projects.lastUpdated', {
                    date: new Date(p.updatedAt).toLocaleDateString(),
                  })}
                </div>
              </div>
            )
          })}
          <div className="project-card project-card-new" onClick={() => void onCreate()} role="button" tabIndex={0}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <PlusOutlined style={{ fontSize: 26 }} />
              <span>{t('projects.newProject')}</span>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={!!renaming}
        title={t('projects.rename')}
        onCancel={() => setRenaming(null)}
        onOk={() => {
          if (renaming?.name.trim()) {
            const st = useProjectStore.getState()
            st.renameProject(renaming.id, renaming.name.trim())
          }
          setRenaming(null)
        }}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
      >
        <Input
          value={renaming?.name ?? ''}
          onChange={(e) => setRenaming((r) => (r ? { ...r, name: e.target.value } : r))}
          onPressEnter={() => {
            if (renaming?.name.trim()) {
              useProjectStore.getState().renameProject(renaming.id, renaming.name.trim())
            }
            setRenaming(null)
          }}
        />
      </Modal>

      <Modal
        open={!!deleting}
        title={t('projects.delete')}
        onCancel={() => setDeleting(null)}
        onOk={() => {
          if (deleting) void deleteProject(deleting.id)
          setDeleting(null)
        }}
        okText={t('common.delete')}
        cancelText={t('common.cancel')}
        okButtonProps={{ danger: true }}
      >
        {t('projects.deleteConfirm', { name: deleting?.name ?? '' })}
      </Modal>
    </div>
  )
}
