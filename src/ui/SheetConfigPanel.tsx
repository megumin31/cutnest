/**
 * 左栏 · 配置面板（v1.2 方向 D）——
 * 板材库：Excel 式网格表格（勾选 | 名称 | 尺寸 | 单价 | 编辑），勾选行即启用（≥1 行强制）；
 * 工艺参数：普通表单（双列紧凑，不表格化），⚙ 设置入口 = 价格核算弹窗（全局配置）。
 */
import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import { Button, Checkbox, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Switch, Table, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DeleteOutlined, PlusOutlined, SettingOutlined } from '@ant-design/icons'
import { useProjectStore } from '../features/projects/projectStore'
import { useSettingsStore } from '../features/settings/settingsStore'
import { storage } from '../infra/storage'
import { DEFAULT_SHEETS, DEFAULT_KERF } from '../domain/materials'
import type { SheetSpec } from '../domain/types'

/** 计算质量三档（搜索强度锚定：每零件迭代数，与零件数量无关） */
export type Quality = 'fast' | 'standard' | 'fine'

export function SheetConfigPanel() {
  const { t } = useTranslation()
  const current = useProjectStore((s) => s.current)
  const updateSheets = useProjectStore((s) => s.updateSheets)
  const updateSettings = useProjectStore((s) => s.updateSettings)
  const pricing = useSettingsStore((s) => s.settings.pricing)
  const updatePricing = useSettingsStore((s) => s.updatePricing)
  const [customSheets, setCustomSheets] = useState<SheetSpec[]>([])
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

  /** 行内编辑（高频）：只写项目（projectStore 防抖持久化），不失焦不碰全局库 */
  const patchSheet = (id: string, patch: Partial<SheetSpec>) => {
    updateSheets(sheets.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  /** 行内编辑提交（失焦）：项目写入 + 自定义规格同步全局库（内置规格仅项目覆盖，id 不变） */
  const commitSheet = (id: string, patch: Partial<SheetSpec>) => {
    patchSheet(id, patch)
    const spec = sheets.find((s) => s.id === id)
    if (spec && customSheets.some((c) => c.id === id)) {
      const next = { ...spec, ...patch }
      next.name = next.name.trim() || t('leftPanel.sheetDefaultName')
      void storage.saveMaterial(next)
      void reloadMaterials()
    }
  }

  /** 添加 = 直接追加一行（勾选即启用），行内编辑失焦时写入全局库 */
  const addSheet = () => {
    updateSheets([
      ...sheets,
      { id: `mat-${Date.now()}`, name: '', length: 2440, width: 1220, price: 98 },
    ])
  }

  /** 删除：从项目移除；自定义规格同步删全局库；最后一种规格禁止删除（≥1 约束） */
  const removeSheet = (id: string) => {
    if (sheets.length <= 1) return
    updateSheets(sheets.filter((s) => s.id !== id))
    if (customSheets.some((c) => c.id === id)) {
      void storage.deleteMaterial(id)
      void reloadMaterials()
    }
  }

  /** 板材库网格表格（与零件表同形态）：行号 | 勾选 | 名称 | 长 | 宽 | 单价 | 删除，单元格即输入框 */
  const sheetColumns: ColumnsType<SheetSpec> = [
    {
      title: '#',
      key: 'row',
      width: 24,
      onCell: () => ({ className: 'row-num-cell' }),
      render: (_v, _r, index) => (
        <span style={{ color: 'var(--text-disabled)', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
          {index + 1}
        </span>
      ),
    },
    {
      title: '☑',
      key: 'checked',
      width: 40,
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
      width: 160,
      render: (v: string, s) => (
        <Input
          size="small"
          variant="borderless"
          className="name-input"
          value={v}
          placeholder={t('leftPanel.sheetDefaultName')}
          onChange={(e) => patchSheet(s.id, { name: e.target.value })}
          onBlur={() => commitSheet(s.id, {})}
        />
      ),
    },
    {
      title: t('leftPanel.length'),
      dataIndex: 'length',
      key: 'length',
      width: 64,
      render: (v: number, s) => (
        <InputNumber
          size="small"
          variant="borderless"
          min={1}
          controls={false}
          value={v}
          style={{ width: '100%' }}
          onChange={(x) => patchSheet(s.id, { length: Math.max(1, Math.round(x ?? 1)) })}
          onBlur={() => commitSheet(s.id, {})}
        />
      ),
    },
    {
      title: t('leftPanel.width'),
      dataIndex: 'width',
      key: 'width',
      width: 64,
      render: (v: number, s) => (
        <InputNumber
          size="small"
          variant="borderless"
          min={1}
          controls={false}
          value={v}
          style={{ width: '100%' }}
          onChange={(x) => patchSheet(s.id, { width: Math.max(1, Math.round(x ?? 1)) })}
          onBlur={() => commitSheet(s.id, {})}
        />
      ),
    },
    {
      title: t('leftPanel.unitPrice'),
      key: 'price',
      width: 100,
      render: (_v, s) =>
        pricing.enabled ? (
          <InputNumber
            size="small"
            variant="borderless"
            min={0}
            controls={false}
            value={s.price}
            style={{ width: '100%' }}
            onChange={(x) => patchSheet(s.id, { price: Math.max(0, x ?? 0) })}
            onBlur={() => commitSheet(s.id, {})}
          />
        ) : (
          <span style={{ color: 'var(--text-disabled)' }}>—</span>
        ),
    },
    {
      title: '',
      key: 'remove',
      width: 36,
      render: (_v, s) => (
        <Popconfirm
          title={t('leftPanel.confirmRemoveSheet', { name: s.name })}
          okText={t('common.delete')}
          cancelText={t('common.cancel')}
          onConfirm={() => removeSheet(s.id)}
        >
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={sheets.length <= 1}
            aria-label={t('leftPanel.remove')}
          />
        </Popconfirm>
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
          <Button type="text" size="small" icon={<PlusOutlined />} onClick={addSheet}>
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
