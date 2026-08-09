/**
 * 设置页 —— 单列设置表单：默认板材库/工艺默认/价格/单位/界面语言/导出语言/主题（UI-DESIGN.md §6.4）。
 */
import { useTranslation } from 'react-i18next'
import i18n from 'i18next'
import { App as AntApp, Button, Card, InputNumber, Select } from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { useSettingsStore } from '../features/settings/settingsStore'
import { storage } from '../infra/storage'
import { LANGUAGES } from '../features/i18n'
import { DEFAULT_SHEETS } from '../domain/materials'
import type { SheetSpec } from '../domain/types'
import { useEffect, useState } from 'react'

export function SettingsPage() {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const [materials, setMaterials] = useState<SheetSpec[]>([])

  useEffect(() => {
    void storage.listMaterials().then(setMaterials)
  }, [])

  const reloadMaterials = async () => {
    setMaterials(await storage.listMaterials())
  }

  const onAddMaterial = async () => {
    const spec: SheetSpec = {
      id: `mat-${Date.now()}`,
      name: t('settings.materialName'),
      length: 2440,
      width: 1220,
      price: 98,
    }
    await storage.saveMaterial(spec)
    await reloadMaterials()
  }

  const row: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 0',
    borderBottom: '1px solid var(--border)',
  }

  const label: React.CSSProperties = { fontSize: 13 }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '32px', maxWidth: 560, margin: '0 auto', width: '100%' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 20 }}>{t('settings.title')}</h1>

      {/* 界面语言置顶：语言切换是最常用设置 */}
      <Card title={t('settings.uiLanguage')} styles={{ body: { padding: '4px 20px' } }}>
        <div style={row}>
          <span style={label}>{t('settings.uiLanguage')}</span>
          <Select
            size="small"
            style={{ width: 200 }}
            value={settings.uiLang}
            options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
            onChange={(v) => {
              void update({ uiLang: v })
              void i18n.changeLanguage(v)
            }}
          />
        </div>
        <div style={row}>
          <span style={label}>{t('settings.exportLanguage')}</span>
          <Select
            size="small"
            style={{ width: 200 }}
            value={settings.exportLang}
            options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
            onChange={(v) => void update({ exportLang: v })}
          />
        </div>
        <div style={row}>
          <span style={label}>{t('settings.theme')}</span>
          <Select
            size="small"
            style={{ width: 160 }}
            value={settings.theme}
            options={[
              { value: 'light', label: t('settings.themeLight') },
              { value: 'dark', label: t('settings.themeDark') },
              { value: 'system', label: t('settings.themeSystem') },
            ]}
            onChange={(v) => void update({ theme: v })}
          />
        </div>
      </Card>

      <Card title={t('settings.defaultSheet')} style={{ marginTop: 16 }} styles={{ body: { padding: '4px 20px' } }}>
        <div style={row}>
          <span style={label}>{t('leftPanel.sheetLibrary')}</span>
          <Select
            size="small"
            mode="multiple"
            style={{ width: 220 }}
            value={settings.defaultSheetIds ?? []}
            placeholder={t('settings.defaultSheet')}
            options={[...DEFAULT_SHEETS, ...materials].map((m) => ({
              value: m.id,
              label: `${m.name} ${m.length}×${m.width}（¥${m.price}）`,
            }))}
            onChange={(v) => void update({ defaultSheetIds: v })}
          />
        </div>
        <div style={row}>
          <span style={label}>{t('settings.kerf')}</span>
          <InputNumber
            size="small"
            min={0}
            step={0.5}
            value={settings.kerf}
            onChange={(v) => void update({ kerf: v ?? 3 })}
          />
        </div>
        <div style={row}>
          <span style={label}>{t('settings.trim')}</span>
          <InputNumber
            size="small"
            min={0}
            step={0.5}
            value={settings.trim}
            onChange={(v) => void update({ trim: v ?? 0 })}
          />
        </div>
        <div style={row}>
          <span style={label}>{t('settings.unit')}</span>
          <Select
            size="small"
            style={{ width: 120 }}
            value={settings.unit}
            options={[
              { value: 'mm', label: 'mm' },
              { value: 'cm', label: 'cm' },
              { value: 'in', label: 'in' },
            ]}
            onChange={(v) => void update({ unit: v })}
          />
        </div>
      </Card>

      <Card title={t('settings.customMaterials')} style={{ marginTop: 16 }} styles={{ body: { padding: '4px 20px' } }}>
        {materials.map((m) => (
          <div key={m.id} style={row}>
            <span style={label}>{m.name}</span>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {m.length}×{m.width} · ¥{m.price}
            </span>
            <Button
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={async () => {
                await storage.deleteMaterial(m.id)
                await reloadMaterials()
                message.success(t('settings.saved'))
              }}
            />
          </div>
        ))}
        <Button size="small" block icon={<PlusOutlined />} style={{ margin: '12px 0' }} onClick={() => void onAddMaterial()}>
          {t('settings.addMaterial')}
        </Button>
      </Card>
    </div>
  )
}
