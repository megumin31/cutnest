/**
 * 全局错误边界 —— 任何渲染异常显示可操作错误卡片（重试/返回列表），
 * 杜绝白屏；异常信息可见，便于定位。
 */
import { Component, type ReactNode } from 'react'
import { Button } from 'antd'
import i18n from 'i18next'
import { useAppStore } from '../features/cutting/planStore'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('[ErrorBoundary]', error, info)
  }

  private reset = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 40,
            background: 'var(--bg)',
          }}
        >
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '28px 32px',
              maxWidth: 480,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 26, marginBottom: 10 }}>⚠️</div>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>{i18n.t('errors.boundaryTitle')}</div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-secondary)',
                fontFamily: 'monospace',
                wordBreak: 'break-all',
                marginBottom: 16,
                background: 'var(--bg)',
                borderRadius: 8,
                padding: '8px 12px',
                textAlign: 'left',
              }}
            >
              {this.state.error.message || String(this.state.error)}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <Button type="primary" onClick={this.reset}>
                {i18n.t('common.retry')}
              </Button>
              <Button
                onClick={() => {
                  this.reset()
                  useAppStore.getState().navigate('projects')
                }}
              >
                {i18n.t('errors.boundaryBack')}
              </Button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
