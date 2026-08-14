/**
 * 左栏 · 配置面板（v1.2 方向 D）——
 * 板材库：Excel 式网格表格（勾选 | 名称 | 尺寸 | 单价 | 编辑），勾选行即启用（≥1 行强制）；
 * 工艺参数：普通表单（双列紧凑，不表格化），⚙ 设置入口 = 价格核算弹窗（全局配置）。
 */
import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import { Button, Checkbox, Input, InputNumber, Modal, Segmented, Select, Switch, Table, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { EditOutlined, PlusOutlined, SettingOutlined } from '@ant-design/icons'
import { useProjectStore } from '../features/projects/projectStore'
import { useSettingsStore } from '../features/settings/settingsStore'
import { storage } from '../infra/storage'
import { DEFAULT_SHEETS, DEFAULT_KERF } from '../domain/materials'
import type { SheetSpec } from '../domain/types'

interface SpecForm {
  id?: string
  name: string
  length: number
  width: number
  price: number
}

/** 计算质量三档（搜索强度锚定：每零件迭代数，与零件数量无关） */
export type Quality = 'fast' | 'standard' | 'fine'

const EMPTY_FORM: SpecForm = { name: '', length: 2440, width: 1220, price: 98 }

export function SheetConfigPanel() {
  const { t } = useTranslation()
  const current = useProjectStore((s) => s.current)
  const updateSheets = useProjectStore((s) => s.updateSheets)
  const updateSettings = useProjectStore((s) => s.updateSettings)
  const pricing = useSettingsStore((s) => s.settings.pricing)
  const updatePricing = useSettingsStore((s) => s.updatePricing)
  const [customSheets, setCustomSheets] = useState<SheetSpec[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<SpecForm>(EMPTY_FORM)
  const [pricingOpen, setPricingOpen] = useState(false)

  const reloadMaterials = async () => {
    setCustomSheets(await storage.listMaterials())
  }
  useEffect(() => {
    void reloadMaterials()
  }, [])

  if (!current) return null
  const { sheets, settings } = current

  // 内置规格 + 设置页自定义板材（按 id 去重），当前库中规格兜底保证可显示
  const all = [...customSheets, ...DEFAULT_SHEETS]

  const byId = new Map(all.map((s) => [s.id, s]))
  for (const s of sheets) if (!byId.has(s.id)) byId.set(s.id, s)
  const sheetOptions = [...byId.values()]

  const toggleSheet = (id: string, checked: boolean) => {
    const next = checked
      ? [...sheets, sheetOptions.find((s) => s.id === id)!]
      : sheets.filter((s) => s.id !== id)
    // 至少保留一种规格（取消最后一种时回弹）
    if (next.length === 0) return
    updateSheets(next)
  }

  const openAdd = () => {
    setForm(EMPTY_FORM)
    setFormOpen(true)
  }

  const openEdit = (spec: SheetSpec) => {
    setForm({ id: spec.id, name: spec.name, length: spec.length, width: spec.width, price: spec.price })
    setFormOpen(true)
  }

  const onSaveSpec = async () => {
    const { id, name, length, width, price } = form
    const spec: SheetSpec = {
      id: id ?? `mat-${Date.now()}`,
      name: name.trim() || t('leftPanel.sheetDefaultName'),
      length: Math.max(1, Math.round(length)),
      width: Math.max(1, Math.round(width)),
      price: Math.max(0, price),
    }
    if (!id) {
      // 添加：写入全局自定义库 + 自动勾选当前项目
      await storage.saveMaterial(spec)
      updateSheets([...sheets, spec])
    } else {
      // 编辑：自定义条目同步全局库；内置条目仅当前项目覆盖（id 不变）
      if (customSheets.some((s) => s.id === id)) await storage.saveMaterial(spec)
      updateSheets(sheets.map((s) => (s.id === id ? spec : s)))
    }
    await reloadMaterials()
    setFormOpen(false)
  }

  /** 板材库网格表格：勾选 | 名称 | 尺寸 | 单价 | 编辑（价格功能关闭时不显示单价） */
  const sheetColumns: ColumnsType<SheetSpec> = [
    {
      title: '☑',
      key: 'checked',
      width: 36,
      align: 'center',
      render: (_v, s) => (
        <Checkbox
          checked={sheets.some((x) => x.id === s.id)}
          onChange={(e) => toggleSheet(s.id, e.target.checked)}
          aria-label={s.name}
        />
      ),
    },
    {
      title: t('leftPanel.name'),
      dataIndex: 'name',
      key: 'name',
      width: 120,
      render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span>,
    },
    {
      title: t('leftPanel.sheetSize'),
      dataIndex: 'length',
      key: 'size',
      width: 110,
      align: 'right',
      render: (_v, s) => (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {s.length}×{s.width}
        </span>
      ),
    },
    {
      title: t('leftPanel.unitPrice'),
      key: 'price',
      width: 64,
      align: 'right',
      render: (_v, s) => (pricing.enabled ? <span>¥{s.price}</span> : <span style={{ color: 'var(--text-disabled)' }}>—</span>),
    },
    {
      title: '',
      key: 'edit',
      width: 40,
      align: 'center',
      render: (_v, s) => (
        <Tooltip title={t('leftPanel.editSheet')}>
          <Button
            size="small"
            type="text"
            icon={<EditOutlined />}
            aria-label={t('leftPanel.editSheet')}
            onClick={() => openEdit(s)}
          />
        </Tooltip>
      ),
    },
  ]

  /** 工艺参数双列表单（label 左 + 控件右） */
  const paramFields: [string, React.ReactNode][] = [
    [
      t('leftPanel.kerf'),
      <InputNumber
        key="kerf"
        size="small"
        min={0}
        step={0.5}
        value={settings.kerf}
        onChange={(v) => updateSettings({ kerf: v ?? DEFAULT_KERF })}
        style={{ width: '100%' }}
      />,
    ],
    [
      t('leftPanel.trimAllowance'),
      <InputNumber
        key="trim"
        size="small"
        min={0}
        step={0.5}
        value={settings.trimAllowance}
        onChange={(v) => updateSettings({ trimAllowance: v ?? 0 })}
        style={{ width: '100%' }}
      />,
    ],
    [
      t('leftPanel.quality'),
      <Select
        key="quality"
        size="small"
        value={settings.quality ?? 'standard'}
        style={{ width: '100%' }}
        options={[
          { value: 'fast', label: t('leftPanel.qualityFast') },
          { value: 'standard', label: t('leftPanel.qualityStandard') },
          { value: 'fine', label: t('leftPanel.qualityFine') },
        ]}
        onChange={(v) => updateSettings({ quality: v as Quality })}
      />,
    ],
    [
      t('leftPanel.minReusableWaste'),
      <InputNumber
        key="waste"
        size="small"
        min={50}
        step={50}
        value={settings.minReusableWaste}
        onChange={(v) => updateSettings({ minReusableWaste: v ?? 200 })}
        style={{ width: '100%' }}
      />,
    ],
  ]

  return (
    <div className="sheets-panel">
      {/* 板材库：网格表格 */}
      <div className="sheets-section">
        <div className="parts-header">
          <span className="panel-title">{t('leftPanel.sheetLibrary')}</span>
          <span className="panel-sub">
            {t('leftPanel.sheetsSelected', { n: sheets.length, m: sheetOptions.length })}
          </span>
          <div style={{ flex: 1 }} />
          <Button type="text" size="small" icon={<PlusOutlined />} onClick={openAdd}>
            {t('leftPanel.addSheet')}
          </Button>
        </div>
        <Table<SheetSpec>
          className="parts-table"
          size="small"
          rowKey="id"
          columns={sheetColumns}
          dataSource={sheetOptions}
          pagination={false}
          bordered
          scroll={{ y: 150 }}
        />
      </div>

      {/* 工艺参数：普通表单 */}
      <div className="sheets-section">
        <div className="parts-header">
          <span className="panel-title">{t('leftPanel.processParams')}</span>
          <div style={{ flex: 1 }} />
          <Tooltip title={t('settings.pricing')}>
            <Button
              type="text"
              size="small"
              icon={<SettingOutlined />}
              aria-label={t('settings.pricing')}
              onClick={() => setPricingOpen(true)}
            />
          </Tooltip>
        </div>
        <div className="params-grid">
          {paramFields.map(([label, control]) => (
            <div key={label} className="param-field">
              <span>{label}</span>
              {control}
            </div>
          ))}
        </div>
      </div>

      {/* 板材规格编辑/添加 */}
      <Modal
        open={formOpen}
        title={form.id ? t('leftPanel.editSheet') : t('leftPanel.addSheet')}
        onOk={() => void onSaveSpec()}
        onCancel={() => setFormOpen(false)}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
          <Input
            value={form.name}
            placeholder={t('leftPanel.sheetName')}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <div style={{ display: 'flex', gap: 10 }}>
            <InputNumber
              style={{ flex: 1 }}
              min={1}
              value={form.length}
              placeholder={t('leftPanel.sheetLength')}
              onChange={(v) => setForm({ ...form, length: v ?? 0 })}
            />
            <InputNumber
              style={{ flex: 1 }}
              min={1}
              value={form.width}
              placeholder={t('leftPanel.sheetWidth')}
              onChange={(v) => setForm({ ...form, width: v ?? 0 })}
            />
          </div>
          <InputNumber
            style={{ width: '100%' }}
            min={0}
            value={form.price}
            placeholder={t('leftPanel.sheetPrice')}
            prefix="¥"
            onChange={(v) => setForm({ ...form, price: v ?? 0 })}
          />
        </div>
      </Modal>

      {/* 价格核算（全局设置） */}
      <Modal
        open={pricingOpen}
        title={t('settings.pricing')}
        onCancel={() => setPricingOpen(false)}
        footer={null}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13 }}>{t('settings.pricingEnabled')}</span>
            <Switch
              size="small"
              checked={pricing.enabled}
              onChange={(v) => void updatePricing({ enabled: v })}
            />
          </div>
          {pricing.enabled && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{t('settings.pricingMode')}</span>
                <Segmented
                  size="small"
                  value={pricing.mode}
                  options={[
                    { value: 'itemized', label: t('settings.pricingModeItemized') },
                    { value: 'byArea', label: t('settings.pricingModeByArea') },
                  ]}
                  onChange={(v) => void updatePricing({ mode: v as 'itemized' | 'byArea' })}
                />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {pricing.mode === 'itemized' ? t('settings.pricingItemizedHint') : t('settings.pricingByAreaHint')}
              </div>
              {pricing.mode === 'itemized' ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{t('settings.edgePrice')}</span>
                    <InputNumber
                      size="small"
                      min={0}
                      step={0.5}
                      value={pricing.edgePricePerM}
                      onChange={(v) => void updatePricing({ edgePricePerM: v ?? 0 })}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{t('settings.processingFee')}</span>
                    <InputNumber
                      size="small"
                      min={0}
                      step={1}
                      value={pricing.processingFeePerSheet}
                      onChange={(v) => void updatePricing({ processingFeePerSheet: v ?? 0 })}
                    />
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{t('settings.areaPrice')}</span>
                  <InputNumber
                    size="small"
                    min={0}
                    step={1}
                    value={pricing.areaPricePerSqm}
                    onChange={(v) => void updatePricing({ areaPricePerSqm: v ?? 0 })}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </Modal>
    </div>
  )
}
