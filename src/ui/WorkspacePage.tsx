/**
 * 项目工作台 —— 三栏骨架 v1.2（UI-DESIGN.md §6.2 方向 D）：
 * 左栏 560 常驻编辑区（零件清单 + 板材库 + 工艺参数）/ 中央结果常驻 / 右栏统计 + 历史。
 * 编辑与结果同屏：改完零件点计算立即看影响，无编辑/结果态切换。
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

  useEffect(() => {
    if (projectId) void openProject(projectId)
  }, [projectId, openProject])

  // 当前项目不存在（已删除）→ 回到列表
  useEffect(() => {
    if (!current) {
      useAppStore.getState().navigate('projects')
    }
  }, [current])

  return (
    <div
      style={{ display: 'flex', flex: 1, minHeight: 0, width: '100%' }}
      // 全局点击清空选中：任何非零件点击（空白/翻页/板卡片）都清除；零件/列表行点击已 stopPropagation
      onClick={() => usePlanStore.getState().selectPart(null)}
    >
      <aside className="app-left">
        <PartsWorkspace />
        <SheetConfigPanel />
      </aside>
      <main className="app-center">
        <SheetFlow />
      </main>
      <aside className="app-right">
        <StatsPanel />
        <HistoryPanel />
      </aside>
    </div>
  )
}
