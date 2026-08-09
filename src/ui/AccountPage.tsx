/**
 * 账号页 —— 登录/注册（邮箱密码 + Google）/账号状态/剩余次数/购买/设备管理（UI-DESIGN.md §6.4）。
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App as AntApp, Button, Card, Divider, Input, Space, Tag, Tooltip } from 'antd'
import {
  CreditCardOutlined,
  GoogleOutlined,
  LaptopOutlined,
  LogoutOutlined,
  ShoppingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../features/licensing/authStore'
import { apiMode } from '../infra/api'

export function AccountPage() {
  const { t } = useTranslation()
  const { message } = AntApp.useApp()
  const auth = useAuthStore()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const loggedIn = auth.status.state === 'loggedIn'

  useEffect(() => {
    if (auth.status.state === 'loggedIn') void auth.listDevices()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn])

  const submit = async () => {
    if (!email.includes('@') || password.length < 4) {
      message.warning(mode === 'login' ? t('account.email') : t('account.password'))
      return
    }
    try {
      if (mode === 'login') {
        await auth.login(email, password)
      } else {
        await auth.register(email, password)
      }
      message.success(t('account.welcome', { email }))
    } catch {
      // 错误已写入 auth.error
    }
  }

  const st = auth.status
  if (st.state === 'loggedIn') {
    const s = st
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '32px', maxWidth: 760, margin: '0 auto', width: '100%' }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 20 }}>{t('account.title')}</h1>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Card title={t('account.status')} styles={{ body: { padding: 18 } }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <ThunderboltOutlined style={{ fontSize: 22, color: 'var(--accent)' }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{s.email}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('account.welcome', { email: '' })}</div>
              </div>
            </div>
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{t('account.status')}</span>
                <Tag color={s.paid ? 'success' : 'warning'}>{s.paid ? t('account.paid') : t('account.unpaid')}</Tag>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{t('account.credits')}</span>
                <b style={{ fontSize: 17 }}>{s.credits}</b>
              </div>
              <Divider style={{ margin: '4px 0' }} />
              {!s.paid && (
                <Button type="primary" block icon={<ShoppingOutlined />} onClick={() => void auth.buyLicense()}>
                  {t('account.buyBtn')}
                </Button>
              )}
              <Button block icon={<CreditCardOutlined />} onClick={() => message.info(t('account.purchaseHint'))}>
                {t('account.buyCreditsBtn')}
              </Button>
              <Button block danger icon={<LogoutOutlined />} onClick={() => void auth.logout()}>
                {t('account.logout')}
              </Button>
            </Space>
          </Card>

          <Card title={t('account.devices')} styles={{ body: { padding: 18 } }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
              {t('account.devices')}（{auth.devices.length}/3）
            </div>
            {auth.devices.length === 0 && (
              <div style={{ color: 'var(--text-disabled)', fontSize: 13 }}>{t('common.loading')}</div>
            )}
            {auth.devices.map((d) => (
              <div
                key={d.fp}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 0',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <LaptopOutlined style={{ fontSize: 16, color: 'var(--text-secondary)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {d.fp}
                    {d.current && (
                      <Tag color="blue" style={{ marginLeft: 8 }}>
                        {t('account.deviceCurrent')}
                      </Tag>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-disabled)' }}>
                    {new Date(d.lastSeenAt).toLocaleString()}
                  </div>
                </div>
                {!d.current && (
                  <Tooltip title={t('account.deviceRevoke')}>
                    <Button
                      size="small"
                      type="text"
                      danger
                      onClick={() => void auth.revokeDevice(d.fp)}
                      aria-label={t('account.deviceRevoke')}
                    >
                      {t('account.deviceRevoke')}
                    </Button>
                  </Tooltip>
                )}
              </div>
            ))}
          </Card>
        </div>
        {apiMode === 'mock' && (
          <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-disabled)' }}>
            {t('common.demoMode')}：{t('account.purchaseHint')}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 20px', overflowY: 'auto' }}>
      <Card style={{ width: 380 }} styles={{ body: { padding: 28 } }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
          <ThunderboltOutlined style={{ color: 'var(--accent)', fontSize: 22 }} />
          <span style={{ fontWeight: 700, fontSize: 18 }}>{t('common.appName')}</span>
        </div>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>
          {mode === 'login' ? t('account.loginTitle') : t('account.registerTitle')}
        </h2>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 20 }}>
          {t('account.loggedOut')}
        </div>

        {auth.error && (
          <div
            style={{
              background: 'rgba(224,49,49,0.08)',
              color: 'var(--danger, #E03131)',
              padding: '8px 12px',
              borderRadius: 8,
              marginBottom: 12,
              fontSize: 13,
            }}
          >
            {auth.error}
          </div>
        )}

        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Input
            placeholder={t('account.email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            prefix={<span style={{ color: 'var(--text-disabled)' }}>@</span>}
          />
          <Input.Password
            placeholder={t('account.password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onPressEnter={() => void submit()}
          />
          <Button type="primary" block onClick={() => void submit()}>
            {mode === 'login' ? t('account.loginBtn') : t('account.registerBtn')}
          </Button>
          <Button block icon={<GoogleOutlined />} onClick={() => void auth.googleLogin()}>
            {t('account.googleBtn')}
          </Button>
          <div style={{ textAlign: 'center', fontSize: 13 }}>
            <Button
              type="link"
              size="small"
              onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            >
              {mode === 'login' ? t('account.registerLink') : t('account.loginLink')}
            </Button>
          </div>
        </Space>
      </Card>
    </div>
  )
}
