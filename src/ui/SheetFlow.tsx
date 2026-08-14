/**
 * 中央区 —— 状态机（UI-DESIGN.md §6.2）：
 * 编辑态（三步引导卡）→ 结果态（板材卡片流）→ 单板大图（缩放/平移）。
 * 结果出现时板材卡片逐个淡入 + 轻微上移（stagger 80ms）。
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'antd'
import { CloseOutlined } from '@ant-design/icons'
import { usePlanStore } from '../features/cutting/planStore'
import { useProjectStore } from '../features/projects/projectStore'
import { useSettingsStore } from '../features/settings/settingsStore'
import { usableArea } from '../domain/optimizer'
import { CutDiagram } from './CutDiagram'
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
  const selectedPartKey = usePlanStore((s) => s.selectedPartKey)
  const hoverPartKey = usePlanStore((s) => s.hoverPartKey)
  const dirty = useProjectStore((s) => s.dirty)
  const [detailIndex, setDetailIndex] = useState<number | null>(null)
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)

  // 单板大图 = 模态对话框：ESC 关闭 + 打开时焦点移入关闭按钮（最小模态契约）
  useEffect(() => {
    if (detailIndex === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetailIndex(null)
    }
    window.addEventListener('keydown', onKey)
    closeBtnRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [detailIndex])

  if (!current) return null

  const partNames = partNamesOf(current)
  // 名字展示优先排样快照（历史方案不随当前零件表漂移）
  const nameOf = (id: string) => planPartNames?.[id] ?? partNames.get(id)

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

  return (
    <div>
      {dirty && (
        <div className="dirty-banner" role="alert">
          {t('workspace.dirtyHint')}
        </div>
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
                  selectedKey={selectedPartKey}
                  hoverKey={hoverPartKey}
                  partNameOf={nameOf}
                  onSelect={usePlanStore.getState().selectPart}
                  onHover={usePlanStore.getState().setHoverPart}
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
            <Button
              ref={closeBtnRef}
              type="text"
              icon={<CloseOutlined />}
              onClick={() => setDetailIndex(null)}
              aria-label={t('common.close')}
            />
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
              selectedKey={selectedPartKey}
              hoverKey={hoverPartKey}
              partNameOf={nameOf}
              onSelect={usePlanStore.getState().selectPart}
              onHover={usePlanStore.getState().setHoverPart}
            />
          </div>
        </div>
      )}
    </div>
  )
}
