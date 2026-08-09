/**
 * 底部状态栏 —— 计算进度 / 板数 / 利用率 / 网络状态 / 演示模式（UI-DESIGN.md §5）。
 */
import { useTranslation } from 'react-i18next'
import { Progress, Tag } from 'antd'
import { ApiOutlined, CloudServerOutlined } from '@ant-design/icons'
import { usePlanStore } from '../features/cutting/planStore'
import { apiMode } from '../infra/api'

export function StatusBar() {
  const { t } = useTranslation()
  const status = usePlanStore((s) => s.status)
  const progress = usePlanStore((s) => s.progress)
  const plan = usePlanStore((s) => s.plan)
  const error = usePlanStore((s) => s.error)

  return (
    <div className="app-statusbar">
      {status === 'running' && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {t('statusbar.computing', { pct: Math.round(progress * 100) })}
          <Progress
            percent={Math.round(progress * 100)}
            size="small"
            style={{ width: 120, margin: 0 }}
            showInfo={false}
          />
        </span>
      )}
      {status === 'cancelled' && <span>{t('statusbar.cancelled')}</span>}
      {status === 'error' && (
        <span style={{ color: 'var(--danger, #E03131)' }}>
          {t('statusbar.error')}：{error?.message ?? ''}
        </span>
      )}
      {status !== 'running' && status !== 'error' && status !== 'cancelled' && (
        <span>{t('statusbar.idle')}</span>
      )}

      <div style={{ flex: 1 }} />

      {plan && status === 'done' && (
        <>
          <span>{t('statusbar.sheets', { count: plan.stats.sheetCount })}</span>
          <span>{t('statusbar.utilization', { pct: plan.stats.utilization.toFixed(1) })}</span>
        </>
      )}
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <ApiOutlined style={{ color: 'var(--success, #2F9E44)' }} />
        {t('common.networkOnline')}
      </span>
      {apiMode === 'mock' && (
        <Tag color="default" style={{ marginInlineEnd: 0 }}>
          <CloudServerOutlined /> {t('common.demoMode')}
        </Tag>
      )}
    </div>
  )
}
