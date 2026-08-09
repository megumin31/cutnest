/**
 * 项目工作台 —— 三栏骨架 v1.1（UI-DESIGN.md §6.2）：
 * 左栏轻量配置（板材/AI识别/历史）/ 中央状态机（编辑态=零件工作区，结果态=板材卡片流）/
 * 右栏纯结果（仅结果态渲染，编辑态不占位）。
 */
import { useEffect } from 'react'
import { useAppStore, usePlanStore } from '../features/cutting/planStore'
import { useProjectStore } from '../features/projects/projectStore'
import { PartsWorkspace } from './PartsWorkspace'
import { SheetConfigPanel } from './SheetConfigPanel'
import { HistoryPanel } from './HistoryPanel'
import { SheetFlow } from './SheetFlow'
import { StatsPanel } from './StatsPanel'

export function WorkspacePage() {
  const projectId = useAppStore((s) => s.workspaceProjectId)
  const openProject = useProjectStore((s) => s.openProject)
  const current = useProjectStore((s) => s.current)
  const plan = usePlanStore((s) => s.plan)
  const status = usePlanStore((s) => s.status)
  const editMode = usePlanStore((s) => s.editMode)

  useEffect(() => {
    if (projectId) void openProject(projectId)
  }, [projectId, openProject])

  // 当前项目不存在（已删除）→ 回到列表
  useEffect(() => {
    if (!current) {
      useAppStore.getState().navigate('projects')
    }
  }, [current])

  const hasResult = plan && status === 'done'
  const showEdit = !hasResult || editMode

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, width: '100%' }}>
      <aside className="app-left">
        <SheetConfigPanel />
        <HistoryPanel />
      </aside>
      <main className="app-center">
        {showEdit ? <PartsWorkspace /> : <SheetFlow />}
      </main>
      {hasResult && !editMode && (
        <aside className="app-right">
          <StatsPanel />
        </aside>
      )}
    </div>
  )
}
