/**
 * 应用外壳 —— 顶栏 + 三栏/单页 + 底部状态栏（UI-DESIGN.md §5）。
 */
import { useAppStore } from '../features/cutting/planStore'
import { ProjectListPage } from './ProjectListPage'
import { WorkspacePage } from './WorkspacePage'
import { AccountPage } from './AccountPage'
import { SettingsPage } from './SettingsPage'
import { TopBar } from './TopBar'
import { StatusBar } from './StatusBar'
import { ReviewModal } from './ReviewModal'

export function AppShell() {
  const view = useAppStore((s) => s.view)
  return (
    <div className="app-shell">
      <TopBar />
      <div className="app-body">
        {view === 'projects' && <ProjectListPage />}
        {view === 'workspace' && <WorkspacePage />}
        {view === 'account' && <AccountPage />}
        {view === 'settings' && <SettingsPage />}
      </div>
      <StatusBar />
      <ReviewModal />
    </div>
  )
}
