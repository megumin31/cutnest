/**
 * 历史方案去重 —— 纯函数（可单测）。
 * 确定性前提：同输入（零件表/板材库/工艺参数/质量/seed）必然产出同方案，
 * 因此重复点击"计算"不应生成重复历史记录。
 * 指纹 = 稳定序列化（plan 去掉易变字段 id/createdAt）+ 零件名快照（名字属档案内容，
 * 改名 → 指纹变 → 新记录）。djb2 哈希仅作快速预筛，去重最终以内容全等确认（防碰撞误判）。
 */
import type { CutPlan, PlanRecord } from '../../domain/types'

/** 稳定序列化：属性顺序由构造固定，去掉 id/createdAt 两个易变字段 */
function stablePlanJson(plan: CutPlan): string {
  const { id: _id, createdAt: _ct, ...rest } = plan
  return JSON.stringify(rest)
}

function hashString(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return `fp-${(h >>> 0).toString(36)}`
}

/** 计算方案指纹（同输入必同值；任何输入变化指纹变） */
export function planFingerprint(plan: CutPlan, partNames: Record<string, string>): string {
  const names = Object.entries(partNames)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}:${v}`)
    .join('|')
  return hashString(stablePlanJson(plan) + '||' + names)
}

/** 内容全等（排除 id/createdAt）：指纹碰撞时兜底确认 */
function samePlanContent(a: CutPlan, b: CutPlan): boolean {
  return stablePlanJson(a) === stablePlanJson(b)
}

/**
 * 在既有历史记录中找同方案记录（指纹预筛 + 内容全等确认）。
 * 返回重复记录 = 应跳过保存（覆盖语义：更新快照字段但不再新增）。
 */
export function findDuplicatePlan(
  records: PlanRecord[],
  fingerprint: string,
  plan: CutPlan,
): PlanRecord | undefined {
  return records.find((r) => r.fingerprint === fingerprint && r.plan && samePlanContent(r.plan, plan))
}
