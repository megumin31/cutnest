/**
 * 应用入口 —— 主题 / i18n / 路由 / 首次种子数据。
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, App as AntApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import enUS from 'antd/locale/en_US'
import { initI18n } from './features/i18n'
import { useSettingsStore, resolveTheme } from './features/settings/settingsStore'
import { useAuthStore } from './features/licensing/authStore'
import { storage } from './infra/storage'
import { themeCssVars, buildTheme } from './ui/theme'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { AppShell } from './ui/AppShell'
import { createProject } from './features/projects/projectStore'
import { DEFAULT_SHEETS, createDefaultSettings } from './domain/materials'
import './ui/styles.css'

async function seedDemoProject() {
  const seeded = await storage.getSetting<boolean>('seeded-v1')
  if (seeded) return
  const existing = await storage.listProjects()
  if (existing.length > 0) return
  const demo = await createProject('示例 · 客厅柜')
  demo.parts = [
    { id: 'p1', name: '侧板', length: 2440, width: 400, quantity: 4, grain: 'alongLength', edgeBand: ['L', 'R'] },
    { id: 'p2', name: '横档', length: 2440, width: 250, quantity: 2, grain: 'alongLength' },
    { id: 'p3', name: '抽屉面板', length: 1200, width: 400, quantity: 8, edgeBand: ['T', 'B'] },
    { id: 'p4', name: '层板', length: 800, width: 400, quantity: 6 },
    { id: 'p5', name: '竖档', length: 400, width: 300, quantity: 12 },
    { id: 'p6', name: '背板条', length: 300, width: 200, quantity: 16 },
  ]
  demo.sheets = [DEFAULT_SHEETS[0]]
  demo.settings = createDefaultSettings()
  demo.exportPrefs = {
    pdf: {
      watermark: { enabled: true, text: '' },
      companyInfo: { name: '', address: '', phone: '' },
    },
    dxf: { cutDirection: 'climb' },
    unit: 'mm',
  }
  await storage.saveProject(demo)
  await storage.setSetting('seeded-v1', true)
}

async function bootstrap() {
  await seedDemoProject()
  await useSettingsStore.getState().load()
  initI18n(useSettingsStore.getState().settings.uiLang)
  // OAuth 回调恢复必须先于 load()（load 会联网刷新新换的凭证）
  await useAuthStore.getState().completeOAuth()
  void useAuthStore.getState().load()

  const Root = () => {
    const settingsState = useSettingsStore()
    const themeMode = resolveTheme(settingsState.settings.theme)
    const vars = themeCssVars(themeMode)
    const locale = settingsState.settings.uiLang === 'zh' ? zhCN : enUS
    return (
      <ConfigProvider theme={buildTheme(themeMode)} locale={locale}>
        <AntApp>
          <div style={vars as React.CSSProperties} className="app-root">
            <ErrorBoundary>
              <AppShell />
            </ErrorBoundary>
          </div>
        </AntApp>
      </ConfigProvider>
    )
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  )
}

void bootstrap()
