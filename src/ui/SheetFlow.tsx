/**
 * 中央区 —— 状态机（UI-DESIGN.md §6.2）：
 * 编辑态（三步引导卡）→ 结果态（板材卡片流）→ 单板大图（缩放/平移）。
 * 结果出现时板材卡片逐个淡入 + 轻微上移（stagger 80ms）。
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Segmented } from 'antd'
import { CloseOutlined } from '@ant-design/icons'
import { usePlanStore } from '../features/cutting/planStore'
import { useProjectStore } from '../features/projects/projectStore'
import { useSettingsStore } from '../features/settings/settingsStore'
import { usableArea } from '../domain/optimizer'
import { CutDiagram } from './CutDiagram'
import { HistoryPartList } from './HistoryPartList'
import { partNamesOf } from './exportActions'
import { formatLength } from '../domain/units'
import type { SheetSpec } from '../domain/types'

export function SheetFlow() {
  const { t } = useTranslation()
  const plan = usePlanStore((s) => s.plan)
  const status = usePlanStore((s) => s.status)
  const current = useProjectStore((s) => s.current)
  const unit = useSettingsStore((s) => s.settings.unit)
  const planPartNames = usePlanStore((s) => s.planPartNames)
  const planParts = usePlanStore((s) => s.planParts)
  const planIsHistory = usePlanStore((s) => s.planIsHistory)
  const selectedKey = usePlanStore((s) => s.selectedPartKey)
  const setSheetIndex = usePlanStore((s) => s.setSheetIndex)
  const setSelectedPart = usePlanStore((s) => s.setSelectedPart)
  const setHoverPart = usePlanStore((s) => s.setHoverPart)
  const [detailIndex, setDetailIndex] = useState<number | null>(null)
  const [histView, setHistView] = useState<'cut' | 'parts'>('cut')

  if (!current) return null

  const partNames = partNamesOf(current)
  // 名字展示优先排样快照（历史方案不随当前零件表漂移）
  const nameOf = (id: string) =>
    planParts?.find((p) => p.id === id)?.name ?? planPartNames?.[id] ?? partNames.get(id)

  // 图上选中：选中零件所在页与右栏当前页联动（跨页点击后右栏跳转过去并高亮）；取消选中仅清空
  const handleSelect = (key: string | null) => {
    if (key) {
      const idx = plan?.sheets.findIndex((sh) =>
        sh.placements.some((p) => `${p.partId}#${p.instance}` === key),
      )
      if (idx !== undefined && idx >= 0) setSheetIndex(idx)
    }
    setSelectedPart(key)
  }

  // 编辑态：引导卡
  if (!plan || status !== 'done') {
    return (
      <div className="guide-card">
        <div style={{ fontSize: 28, marginBottom: 4 }}>🪵</div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{t('guide.step3')}</div>
        <div style={{ fontSize: 13 }}>
          {t('guide.step1')} · {t('guide.step2')} · {t('guide.step3')}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-disabled)' }}>
          {t('guide.step1Hint')} → {t('guide.step2Hint')} → {t('guide.step3Hint')}
        </div>
      </div>
    )
  }

  // 每张板按自己的规格（plan.sheetLibrary + sheetSpecId）取可用区，与 plan.stats.utilization 口径一致
  const specOf = (specId: string): SheetSpec => plan.sheetLibrary.find((s) => s.id === specId) ?? plan.sheetLibrary[0]

  // 历史方案模式：可在"裁切图 / 零件清单"间切换（普通计算结果仅裁切图）
  if (planIsHistory && histView === 'parts') {
    return (
      <div>
        <Segmented
          size="small"
          value={histView}
          onChange={(v) => setHistView(v as 'cut' | 'parts')}
          options={[
            { value: 'cut', label: t('leftPanel.viewCut') },
            { value: 'parts', label: t('leftPanel.viewParts') },
          ]}
          style={{ marginBottom: 12 }}
        />
        <HistoryPartList parts={planParts} partNames={planPartNames} sheetLibrary={plan.sheetLibrary} />
      </div>
    )
  }

  return (
    <div>
      {planIsHistory && (
        <Segmented
          size="small"
          value={histView}
          onChange={(v) => setHistView(v as 'cut' | 'parts')}
          options={[
            { value: 'cut', label: t('leftPanel.viewCut') },
            { value: 'parts', label: t('leftPanel.viewParts') },
          ]}
          style={{ marginBottom: 12 }}
        />
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
          gap: 16,
        }}
      >
        {plan.sheets.map((layout, i) => {
          const spec = specOf(layout.sheetSpecId)
          const used = layout.placements.reduce((a, p) => a + p.len * p.wid, 0)
          const util = (used / usableArea(spec, plan.settings).area) * 100
          return (
            <div
              key={i}
              className="sheet-card"
              style={{ animationDelay: `${Math.min(i, 8) * 80}ms` }}
              onClick={() => setDetailIndex(i)}
              role="button"
              tabIndex={0}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>
                  {t('sheetCard.sheetN', { n: i + 1 })}
                  <span style={{ color: 'var(--text-disabled)', fontWeight: 400 }}>
                    {' '}
                    {t('sheetCard.of', { total: plan.sheets.length })}
                  </span>
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {formatLength(spec.length, unit)}×{formatLength(spec.width, unit)} {unit}
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                  {t('sheetCard.utilization', { pct: util.toFixed(0) })}
                </span>
              </div>
              <div style={{ width: '100%' }}>
                <CutDiagram
                  plan={plan}
                  sheet={spec}
                  sheetIndex={i}
                  unit={unit}
                  selectedKey={selectedKey}
                  partNameOf={nameOf}
                  onSelect={handleSelect}
                  onHover={setHoverPart}
                />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-disabled)', marginTop: 8 }}>
                {t('sheetCard.partCount', { count: layout.placements.length })}
              </div>
            </div>
          )
        })}
      </div>

      {detailIndex !== null && (
        <div className="sheet-detail-overlay" role="dialog" aria-modal="true">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              height: 56,
              padding: '0 20px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--surface)',
              flexShrink: 0,
            }}
          >
            <Button type="text" icon={<CloseOutlined />} onClick={() => setDetailIndex(null)} aria-label={t('common.close')} />
            <span style={{ fontWeight: 600, fontSize: 15 }}>
              {t('sheetCard.sheetN', { n: detailIndex + 1 })}{' '}
              {t('sheetCard.of', { total: plan.sheets.length })}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {formatLength(specOf(plan.sheets[detailIndex].sheetSpecId).length, unit)}×
              {formatLength(specOf(plan.sheets[detailIndex].sheetSpecId).width, unit)} {unit}
            </span>
            <div style={{ flex: 1 }} />
          </div>
          <div style={{ flex: 1, padding: 24, overflow: 'hidden', display: 'flex' }}>
            <CutDiagram
              plan={plan}
              sheet={specOf(plan.sheets[detailIndex].sheetSpecId)}
              sheetIndex={detailIndex}
              unit={unit}
              detail
              selectedKey={selectedKey}
              partNameOf={nameOf}
              onSelect={handleSelect}
              onHover={setHoverPart}
            />
          </div>
        </div>
      )}
    </div>
  )
}
