/**
 * 方案 store —— 计算结果会话态 + 计算驱动（架构文档 §8.2）。
 */
import { create } from 'zustand'
import type { CutPlan, Part, PlanRecord, Project } from '../../domain/types'
import { storage } from '../../infra/storage'
import { runOptimize, type OptimizeTask } from '../../infra/worker/runOptimize'
import { useSettingsStore } from '../settings/settingsStore'
import { planFingerprint, findDuplicatePlan } from './planFingerprint'

export type ComputeStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled'

interface PlanState {
  plan: CutPlan | null
  status: ComputeStatus
  progress: number
  error: { code: string; message: string } | null
  /** 右栏单板翻页索引 */
  sheetIndex: number
  /** 中央选中零件（partId#instance） */
  selectedPartKey: string | null
  /** 悬停零件（联动高亮） */
  hoverPartKey: string | null
  /** 编辑态/结果态切换（结果态可一键回到零件工作区） */
  editMode: boolean
  task: OptimizeTask | null
  /** 任务序号：run/cancel/reset/openHistory 经 invalidateTask 自增；回调按序号丢弃过期任务（防旧任务 CANCELLED/result 覆盖新状态） */
  runSeq: number
  /** 当前展示方案的零件名快照（partId → name；run 写入项目快照、历史打开写入 record.partNames）——展示与导出不依赖当前零件表 */
  planPartNames: Record<string, string> | null
  /** 当前展示方案的完整零件表快照（仅历史方案载入；run/reset 清空）——历史查看的"零件清单"数据源 */
  planParts: Part[] | null
  /** 当前方案是否来自历史记录（决定中央区是否显示"零件清单"切换） */
  planIsHistory: boolean
  /** 历史落库版本号：saveToHistory 成功后自增——历史列表刷新信号与落库原子绑定（status='done' 早于落库，不能用作刷新时机） */
  historyRev: number
  /** 发起计算（Web Worker 线程内执行，主线程不卡） */
  run: (project: Project) => void
  cancel: () => void
  /** 作废当前任务：取消 + 令牌自增 + 清引用（run/cancel/reset/openHistory 共用，杜绝"取消但回调未作废"） */
  invalidateTask: () => void
  setPlan: (plan: CutPlan) => void
  setStatus: (s: ComputeStatus) => void
  setProgress: (p: number) => void
  setError: (e: { code: string; message: string } | null) => void
  setSheetIndex: (i: number) => void
  setSelectedPart: (key: string | null) => void
  setHoverPart: (key: string | null) => void
  setEditMode: (v: boolean) => void
  /** 载入历史方案视图（plan 来自 PlanRecord，含零件快照） */
  openHistory: (record: PlanRecord) => void
  reset: () => void
  /** 结果落历史（storage.cutPlans）：同指纹不重复新增；每项目保留最近 50 条 */
  saveToHistory: (project: Project, plan: CutPlan) => Promise<void>
}

export const partKey = (partId: string, instance: number) => `${partId}#${instance}`

const HISTORY_LIMIT = 50

export const usePlanStore = create<PlanState>((set, get) => ({
  plan: null,
  status: 'idle',
  progress: 0,
  error: null,
  sheetIndex: 0,
  selectedPartKey: null,
  hoverPartKey: null,
  editMode: false,
  task: null,
  runSeq: 0,
  planPartNames: null,
  planParts: null,
  planIsHistory: false,
  historyRev: 0,

  run(project) {
    get().invalidateTask()
    const seq = get().runSeq + 1
    set({
      status: 'running',
      progress: 0,
      error: null,
      plan: null,
      sheetIndex: 0,
      selectedPartKey: null,
      hoverPartKey: null,
      editMode: false,
      runSeq: seq,
      planPartNames: Object.fromEntries(project.parts.map((p) => [p.id, p.name])),
      planParts: null,
      planIsHistory: false,
    })
    const task = runOptimize(
      {
        parts: project.parts,
        sheets: project.sheets,
        settings: project.settings,
        pricing: useSettingsStore.getState().settings.pricing,
      },
      {
        onProgress: (p) => {
          if (seq !== get().runSeq) return
          set({ progress: p })
        },
        onResult: (plan) => {
          if (seq !== get().runSeq) return
          set({ plan, status: 'done', progress: 1, task: null })
          void get().saveToHistory(project, plan)
        },
        onError: (code, message) => {
          if (seq !== get().runSeq) return
          const status = code === 'CANCELLED' ? 'cancelled' : 'error'
          set({ status, error: { code, message }, task: null })
        },
      },
    )
    set({ task })
  },

  cancel() {
    get().invalidateTask()
    set((s) => (s.status === 'running' ? { status: 'cancelled', progress: 0 } : {}))
  },

  invalidateTask() {
    get().task?.cancel()
    set((s) => ({ runSeq: s.runSeq + 1, task: null }))
  },

  setPlan: (plan) => set({ plan }),
  setStatus: (status) => set({ status }),
  setProgress: (progress) => set({ progress }),
  setError: (error) => set({ error }),
  setSheetIndex: (sheetIndex) => set({ sheetIndex }),
  setSelectedPart: (selectedPartKey) => set({ selectedPartKey }),
  setHoverPart: (hoverPartKey) => set({ hoverPartKey }),
  setEditMode: (editMode) => set({ editMode }),

  openHistory: (record) => {
    get().invalidateTask()
    set({
      plan: record.plan,
      status: 'done',
      progress: 1,
      error: null,
      sheetIndex: 0,
      selectedPartKey: null,
      hoverPartKey: null,
      editMode: false,
      planPartNames: record.partNames ?? null,
      planParts: record.parts ?? null,
      planIsHistory: true,
    })
  },

  reset: () => {
    get().invalidateTask()
    set({
      plan: null,
      status: 'idle',
      progress: 0,
      error: null,
      sheetIndex: 0,
      selectedPartKey: null,
      hoverPartKey: null,
      editMode: false,
      planPartNames: null,
      planParts: null,
      planIsHistory: false,
    })
  },

  async saveToHistory(project, plan) {
    const partNames = Object.fromEntries(project.parts.map((p) => [p.id, p.name]))
    const fingerprint = planFingerprint(plan, partNames)
    const all = await storage.listPlans(project.id)
    // 去重：同输入 → 同方案，重复"计算"不新增历史（只更新快照字段，不产生新条目）
    const dup = findDuplicatePlan(all, fingerprint, plan)
    if (dup) {
      const updated: PlanRecord = {
        ...dup,
        plan,
        partNames,
        parts: project.parts,
        fingerprint,
        projectName: project.name,
      }
      await storage.savePlan(updated)
    } else {
      const record: PlanRecord = {
        id: plan.id || `plan-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        projectId: project.id,
        projectName: project.name,
        plan,
        sheets: project.sheets,
        createdAt: plan.createdAt || Date.now(),
        partNames,
        parts: project.parts,
        fingerprint,
      }
      await storage.savePlan(record)
      // 裁剪：保留最近 50 条
      if (all.length + 1 > HISTORY_LIMIT) {
        const excess = all.slice(HISTORY_LIMIT - 1)
        await Promise.all(excess.map((r) => storage.deletePlan(r.id)))
      }
    }
    // 落库成功才通知刷新（status='done' 早于落库，历史列表以本信号为准）
    set((s) => ({ historyRev: s.historyRev + 1 }))
  },
}))

/** 路由视图 */
export type AppView = 'projects' | 'workspace' | 'account' | 'settings'

interface AppState {
  view: AppView
  /** 进入当前视图前的视图（返回按钮用；仅 account/settings 跳转时记录） */
  prevView: AppView | null
  workspaceProjectId: string | null
  navigate: (view: AppView, projectId?: string) => void
  /** 返回上一视图：account/settings 恢复来源；workspace 回项目列表 */
  back: () => void
}

export const useAppStore = create<AppState>((set, get) => ({
  view: 'projects',
  prevView: null,
  workspaceProjectId: null,
  navigate: (view, projectId) =>
    set((s) => ({
      view,
      prevView: view !== s.view ? s.view : s.prevView,
      // 仅 workspace 需要 projectId；跳转 account/settings 时保留，返回工作区不丢上下文
      workspaceProjectId: projectId !== undefined ? projectId : s.workspaceProjectId,
    })),
  back: () => {
    const s = get()
    if (s.view === 'workspace') {
      set({ view: 'projects', workspaceProjectId: null, prevView: null })
    } else if (s.prevView) {
      set({ view: s.prevView, prevView: null })
    } else {
      set({ view: 'projects', prevView: null })
    }
  },
}))
