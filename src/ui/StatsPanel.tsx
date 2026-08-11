/**
 * 右栏 —— 方案总览 + 单板统计（◀▶ 翻页）+ 选中零件详情（UI-DESIGN.md §6.2）。
 */
import { useTranslation } from 'react-i18next'
import { Button, Divider } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import { usePlanStore, partKey } from '../features/cutting/planStore'
import { useProjectStore } from '../features/projects/projectStore'
import { useSettingsStore } from '../features/settings/settingsStore'
import { planCost } from '../domain/pricing'
import { usableArea } from '../domain/optimizer'
import { formatLength, formatSqm } from '../domain/units'

export function StatsPanel() {
  const { t } = useTranslation()
  const plan = usePlanStore((s) => s.plan)
  const sheetIndex = usePlanStore((s) => s.sheetIndex)
  const setSheetIndex = usePlanStore((s) => s.setSheetIndex)
  const selectedKey = usePlanStore((s) => s.selectedPartKey)
  const setSelectedPart = usePlanStore((s) => s.setSelectedPart)
  const current = useProjectStore((s) => s.current)
  const unit = useSettingsStore((s) => s.settings.unit)
  const pricingEnabled = useSettingsStore((s) => s.settings.pricing.enabled)
  const pricing = useSettingsStore((s) => s.settings.pricing)
  // 排样快照（名字优先快照：历史方案不随当前零件表漂移）
  const planPartNames = usePlanStore((s) => s.planPartNames)
  const planParts = usePlanStore((s) => s.planParts)

  if (!plan || !current) return null

  const stats = plan.stats
  const sheetCount = plan.sheets.length
  const layout = plan.sheets[Math.min(sheetIndex, sheetCount - 1)]
  const sheetUsed = layout?.placements.reduce((a, p) => a + p.len * p.wid, 0) ?? 0
  // 与 plan.stats.utilization 同口径：按该板规格的可用区（trim/margin 后）
  const specOf = (specId: string) => plan.sheetLibrary.find((s) => s.id === specId) ?? plan.sheetLibrary[0]
  const sheetSpec = layout ? specOf(layout.sheetSpecId) : null
  const sheetUtil =
    layout && sheetSpec ? ((sheetUsed / usableArea(sheetSpec, plan.settings).area) * 100).toFixed(1) : '0.0'

  const selected = layout?.placements.find((p) => partKey(p.partId, p.instance) === selectedKey) ?? null
  const nameOf = (partId: string) =>
    planParts?.find((p) => p.id === partId)?.name ??
    planPartNames?.[partId] ??
    current.parts.find((p) => p.id === partId)?.name ??
    partId
  // 数量取方案实际排入块数（跨板统计）
  const countInPlan = (partId: string) =>
    plan.sheets.reduce((n, sh) => n + sh.placements.filter((p) => p.partId === partId).length, 0)
  const selectedName = selected ? nameOf(selected.partId) : null

  const statItems: [string, string][] = [
    [t('rightPanel.sheetCount'), String(stats.sheetCount)],
    [t('rightPanel.utilization'), `${stats.utilization.toFixed(1)}%`],
    [t('rightPanel.partArea'), formatSqm(stats.partArea ?? 0)],
    [t('rightPanel.edgeMeters'), `${(stats.edgeMeters ?? 0).toFixed(1)} m`],
    [t('rightPanel.wasteArea'), formatSqm(stats.wasteArea)],
    [t('rightPanel.reusableBlocks'), String(stats.reusableWasteBlocks)],
    [t('rightPanel.largestBlock'), formatSqm(stats.largestReusableWaste)],
  ]
  // 总成本固定末尾（开关只影响是否展示，不影响前面卡片位置）
  if (pricingEnabled) {
    statItems.push([t('rightPanel.totalCost'), `¥${planCost(stats, pricing).toFixed(0)}`])
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12 }}>
        {t('rightPanel.planOverview')}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
          marginBottom: 18,
        }}
      >
        {statItems.map(([label, value]) => (
          <div
            key={label}
            style={{
              background: 'var(--bg)',
              borderRadius: 10,
              padding: '10px 12px',
              border: '1px solid var(--border)',
            }}
          >
            <div className="stat-label">{label}</div>
            <div className="stat-value" style={{ fontSize: 17 }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      <Divider style={{ margin: '8px 0 12px' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
          {t('rightPanel.sheetDetail')}
        </span>
        <div style={{ flex: 1 }} />
        <Button
          size="small"
          type="text"
          icon={<LeftOutlined />}
          disabled={sheetIndex <= 0}
          onClick={() => setSheetIndex(sheetIndex - 1)}
          aria-label={t('rightPanel.prev')}
        />
        <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
          {Math.min(sheetIndex + 1, sheetCount)} / {sheetCount}
        </span>
        <Button
          size="small"
          type="text"
          icon={<RightOutlined />}
          disabled={sheetIndex >= sheetCount - 1}
          onClick={() => setSheetIndex(sheetIndex + 1)}
          aria-label={t('rightPanel.next')}
        />
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
        {sheetSpec && (
          <>
            {formatLength(sheetSpec.length, unit)}×{formatLength(sheetSpec.width, unit)} {unit} ·{' '}
          </>
        )}
        {t('sheetCard.utilization', { pct: sheetUtil })} ·{' '}
        {t('sheetCard.partCount', { count: layout?.placements.length ?? 0 })}
      </div>

      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '6px 10px',
          fontSize: 13,
          maxHeight: 260,
          overflowY: 'auto',
        }}
      >
        {layout?.placements.map((p) => {
          const key = partKey(p.partId, p.instance)
          const active = selectedKey === key
          return (
            <div
              key={key}
              onClick={() => setSelectedPart(active ? null : key)}
              onMouseEnter={() => usePlanStore.getState().setHoverPart(key)}
              onMouseLeave={() => usePlanStore.getState().setHoverPart(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 6,
                cursor: 'pointer',
                background: active ? 'rgba(232,89,12,0.10)' : undefined,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: 'var(--accent)',
                  opacity: 0.7,
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {nameOf(p.partId)}
                {p.rotated ? ' ⟳' : ''}
              </span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                {formatLength(p.len, unit)}×{formatLength(p.wid, unit)}
              </span>
            </div>
          )
        })}
      </div>

      {selected && selectedName && (
        <>
          <Divider style={{ margin: '12px 0' }} />
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
            {t('rightPanel.partDetail')}
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{selectedName}</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
            {t('rightPanel.partDims', {
              len: formatLength(selected.len, unit),
              wid: formatLength(selected.wid, unit),
              unit,
            })}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {t('rightPanel.instanceCount', { n: selected.instance + 1 })} / {countInPlan(selected.partId)}
            {selected.rotated && <span> · {t('rightPanel.rotated')}</span>}
          </div>
        </>
      )}
    </div>
  )
}
