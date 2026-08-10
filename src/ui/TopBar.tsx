/**
 * 顶栏 —— logo / 项目名(可编辑) / [▶计算(脏变橙)] / 导出▾ / 语言 / 账号（UI-DESIGN.md §6.2）。
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from 'i18next'
import { App as AntApp, Button, Dropdown, Input, Select, Space, Tag } from 'antd'
import {
  ArrowLeftOutlined,
  EditOutlined,
  ExportOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  LoadingOutlined,
  SettingOutlined,
  StopOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { useAppStore, usePlanStore } from '../features/cutting/planStore'
import { useProjectStore } from '../features/projects/projectStore'
import { useAuthStore, TRIAL_PART_LIMIT } from '../features/licensing/authStore'
import { useSettingsStore } from '../features/settings/settingsStore'
import { LANGUAGES } from '../features/i18n'
import { exportPdf, exportDxf } from './exportActions'

export function TopBar() {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const view = useAppStore((s) => s.view)
  const navigate = useAppStore((s) => s.navigate)
  const back = useAppStore((s) => s.back)
  const current = useProjectStore((s) => s.current)
  const dirty = useProjectStore((s) => s.dirty)
  const renameProject = useProjectStore((s) => s.renameProject)
  const markClean = useProjectStore((s) => s.markClean)
  const plan = usePlanStore((s) => s.plan)
  const status = usePlanStore((s) => s.status)
  const editMode = usePlanStore((s) => s.editMode)
  const auth = useAuthStore((s) => s.status)
  const settingsStore = useSettingsStore()

  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

  const inWorkspace = view === 'workspace'
  const paid = auth.state === 'loggedIn' && auth.paid
  const trial = !paid

  const partCount = current?.parts.reduce((s, p) => s + p.quantity, 0) ?? 0
  const overTrial = trial && partCount > TRIAL_PART_LIMIT

  const onCalculate = () => {
    if (status === 'running') {
      usePlanStore.getState().cancel()
      return
    }
    if (!current || partCount === 0) return
    // 未登录 = 体验版（≤20 零件，架构文档 §2/§9），不需要登录即可计算
    if (overTrial) {
      message.warning(t('account.trialLimit', { limit: TRIAL_PART_LIMIT }))
      navigate('account')
      return
    }
    usePlanStore.getState().run(current)
    markClean()
  }

  const onExport = async (kind: 'pdf' | 'dxf') => {
    if (!current || !plan) return
    try {
      if (kind === 'pdf') {
        await exportPdf(current, plan, auth, settingsStore.settings.exportLang)
      } else {
        await exportDxf(current, plan)
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    }
  }

  const exportItems = [
    {
      key: 'pdf',
      label: (
        <span>
          {t('workspace.exportPdf')}
          <span className="menu-hint">{t('workspace.exportPdfHint')}</span>
        </span>
      ),
      icon: <FilePdfOutlined />,
      onClick: () => void onExport('pdf'),
      // dirty：零件已改动但未重算，导出旧方案会造成图纸与清单不符
      disabled: !plan || dirty,
    },
    {
      key: 'dxf',
      label: (
        <span>
          {t('workspace.exportDxf')}
          <span className="menu-hint">{t('workspace.exportDxfHint')}</span>
        </span>
      ),
      icon: <FileTextOutlined />,
      onClick: () => void onExport('dxf'),
      disabled: !plan || dirty || trial,
    },
  ]

  return (
    <div className="app-topbar">
      {view !== 'projects' && (
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={back} aria-label={t('common.back')} />
      )}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}
        onClick={() => navigate('projects')}
        role="button"
        tabIndex={0}
        aria-label={t('nav.projects')}
      >
        <ThunderboltOutlined style={{ color: 'var(--accent)', fontSize: 18 }} />
        <span>{t('common.appName')}</span>
      </div>

      {inWorkspace && current && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {editingName ? (
            <Input
              autoFocus
              size="small"
              value={nameDraft}
              placeholder={t('workspace.projectNamePlaceholder')}
              style={{ width: 200 }}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commit}
              onPressEnter={commit}
            />
          ) : (
            <span
              style={{ cursor: 'pointer', fontWeight: 600, fontSize: 15, whiteSpace: 'nowrap' }}
              onClick={() => {
                setNameDraft(current.name)
                setEditingName(true)
              }}
              title={t('common.edit')}
            >
              {current.name}
              <span style={{ color: 'var(--text-disabled)', fontSize: 12, marginLeft: 6 }}>✎</span>
            </span>
          )}
          {dirty && status !== 'running' && (
            <Tag color="warning" style={{ marginInlineEnd: 0 }}>
              {t('workspace.dirtyHint')}
            </Tag>
          )}
        </div>
      )}

      <div style={{ flex: 1 }} />

      {inWorkspace && (
        <Space>
          <Button
            type="primary"
            size="middle"
            icon={status === 'running' ? <StopOutlined /> : <ThunderboltOutlined />}
            onClick={onCalculate}
            disabled={!current || partCount === 0}
            style={dirty && status !== 'running' && !overTrial ? { background: 'var(--accent)', borderColor: 'var(--accent)' } : undefined}
          >
            {status === 'running' ? (
              <>
                <LoadingOutlined /> {t('workspace.calculating')}
              </>
            ) : (
              t('workspace.calculate')
            )}
          </Button>
          <Dropdown menu={{ items: exportItems }} trigger={['click']}>
            <Button icon={<ExportOutlined />}>{t('workspace.export')}</Button>
          </Dropdown>
          {plan && status === 'done' && !editMode && (
            <Button icon={<EditOutlined />} onClick={() => usePlanStore.getState().setEditMode(true)}>
              {t('workspace.editParts')}
            </Button>
          )}
        </Space>
      )}

      <Select
        size="small"
        variant="borderless"
        value={settingsStore.settings.uiLang}
        style={{ width: 96 }}
        options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
        onChange={(v) => {
          void settingsStore.update({ uiLang: v })
          void i18n.changeLanguage(v)
        }}
        popupMatchSelectWidth={false}
        aria-label={t('nav.language')}
      />

      <Button
        type="text"
        icon={<SettingOutlined />}
        onClick={() => navigate('settings')}
        aria-label={t('nav.settings')}
      />

      <Button
        type="text"
        icon={<UserOutlined />}
        onClick={() => navigate('account')}
        style={{ fontWeight: 500 }}
      >
        {auth.state === 'loggedIn' ? (
          <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{auth.email}</span>
        ) : (
          t('nav.login')
        )}
      </Button>
      {auth.state === 'loggedIn' && (
        <Tag color={auth.paid ? 'success' : 'warning'} style={{ marginInlineEnd: 0 }}>
          {auth.paid ? t('account.paid') : t('account.unpaid')}
        </Tag>
      )}
    </div>
  )

  function commit() {
    if (nameDraft.trim()) renameProject(nameDraft.trim())
    setEditingName(false)
  }
}
