/**
 * 历史方案继续编辑 —— 把目标历史方案的输入态（零件表快照 + 板材库 + 排样设置）
 * 恢复进当前项目零件工作区，随后可直接修改并再次计算。
 * 零件快照缺失（旧记录）时从排样结果聚合重建。
 *
 * 参数化语义：
 * - 传入 record（历史行菜单）＝ 显式目标，恢复该记录，不依赖“当前打开了哪条方案”；
 * - 缺省（顶栏按钮）＝ 恢复当前打开的方案（调用方保证 planIsHistory）。
 */
import { useProjectStore } from '../projects/projectStore'
import { usePlanStore } from './planStore'
import { rebuildPartsFromPlan } from './planSnapshot'
import type { PlanRecord } from '../../domain/types'

export function continueFromHistory(record?: PlanRecord): boolean {
  const s = usePlanStore.getState()
  const plan = record?.plan ?? s.plan
  // 无参调用要求当前打开的是历史方案（顶栏路径）；显式传参以记录为目标，不依赖打开状态
  if (!plan || (!record && !s.planIsHistory)) return false
  const partNames = record?.partNames ?? s.planPartNames
  const parts = record?.parts ?? s.planParts ?? rebuildPartsFromPlan(plan, partNames)
  const ps = useProjectStore.getState()
  if (!ps.current || parts.length === 0) return false
  ps.updateParts(parts)
  if (plan.sheetLibrary.length > 0) ps.updateSheets(plan.sheetLibrary)
  ps.updateSettings(plan.settings)
  usePlanStore.getState().reset()
  return true
}
