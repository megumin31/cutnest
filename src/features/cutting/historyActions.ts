/**
 * 历史方案继续编辑 —— 把当前查看的历史方案输入态（零件表快照 + 板材库 + 排样设置）
 * 恢复进当前项目零件工作区，随后可直接修改并再次计算。
 * 零件快照缺失（旧记录）时从排样结果聚合重建。
 */
import { useProjectStore } from '../projects/projectStore'
import { usePlanStore } from './planStore'
import { rebuildPartsFromPlan } from './planSnapshot'

export function continueFromHistory(): boolean {
  const s = usePlanStore.getState()
  if (!s.plan || !s.planIsHistory) return false
  const parts = s.planParts ?? rebuildPartsFromPlan(s.plan, s.planPartNames)
  const ps = useProjectStore.getState()
  if (!ps.current || parts.length === 0) return false
  ps.updateParts(parts)
  if (s.plan.sheetLibrary.length > 0) ps.updateSheets(s.plan.sheetLibrary)
  ps.updateSettings(s.plan.settings)
  usePlanStore.getState().reset()
  return true
}
