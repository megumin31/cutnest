/**
 * 方案 store —— 计算结果会话态 + 计算驱动（架构文档 §8.2）。
 */
import { create } from 'zustand'
import type { CutPlan, PlanRecord, Project } from '../../domain/types'
import { storage } from '../../infra/storage'
import { runOptimize, type OptimizeTask } from '../../infra/worker/runOptimize'
import { useSettingsStore } from '../settings/settingsStore'

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
  /** 发起计算（Web Worker 线程内执行，主线程不卡） */
  run: (project: Project) => void
  cancel: () => void
  setPlan: (plan: CutPlan) => void
  setStatus: (s: ComputeStatus) => void
  setProgress: (p: number) => void
  setError: (e: { code: string; message: string } | null) => void
  setSheetIndex: (i: number) => void
  setSelectedPart: (key: string | null) => void
  setHoverPart: (key: string | null) => void
  setEditMode: (v: boolean) => void
  reset: () => void
  /** 结果落历史（storage.cutPlans），每项目保留最近 50 条 */
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

  run(project) {
    get().task?.cancel()
    set({
      status: 'running',
      progress: 0,
      error: null,
      plan: null,
      sheetIndex: 0,
      selectedPartKey: null,
      hoverPartKey: null,
      editMode: false,
    })
    const task = runOptimize(
      {
        parts: project.parts,
        sheets: project.sheets,
        settings: project.settings,
        pricing: useSettingsStore.getState().settings.pricing,
      },
      {
        onProgress: (p) => set({ progress: p }),
        onResult: (plan) => {
          set({ plan, status: 'done', progress: 1, task: null })
          void get().saveToHistory(project, plan)
        },
        onError: (code, message) => {
          const status = code === 'CANCELLED' ? 'cancelled' : 'error'
          set({ status, error: { code, message }, task: null })
        },
      },
    )
    set({ task })
  },

  cancel() {
    get().task?.cancel()
    set((s) => (s.status === 'running' ? { status: 'cancelled', progress: 0, task: null } : {}))
  },

  setPlan: (plan) => set({ plan }),
  setStatus: (status) => set({ status }),
  setProgress: (progress) => set({ progress }),
  setError: (error) => set({ error }),
  setSheetIndex: (sheetIndex) => set({ sheetIndex }),
  setSelectedPart: (selectedPartKey) => set({ selectedPartKey }),
  setHoverPart: (hoverPartKey) => set({ hoverPartKey }),
  setEditMode: (editMode) => set({ editMode }),

  reset: () =>
    set({
      plan: null,
      status: 'idle',
      progress: 0,
      error: null,
      sheetIndex: 0,
      selectedPartKey: null,
      hoverPartKey: null,
      editMode: false,
      task: null,
    }),

  async saveToHistory(project, plan) {
    const record: PlanRecord = {
      id: plan.id || `plan-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      projectId: project.id,
      projectName: project.name,
      plan,
      sheets: project.sheets,
      createdAt: plan.createdAt || Date.now(),
      partNames: Object.fromEntries(project.parts.map((p) => [p.id, p.name])),
    }
    await storage.savePlan(record)
    // 裁剪：保留最近 50 条
    const all = await storage.listPlans(project.id)
    if (all.length > HISTORY_LIMIT) {
      const excess = all.slice(HISTORY_LIMIT)
      await Promise.all(excess.map((r) => storage.deletePlan(r.id)))
    }
  },
}))

/** 路由视图 */
export type AppView = 'projects' | 'workspace' | 'account' | 'settings'

interface AppState {
  view: AppView
  workspaceProjectId: string | null
  navigate: (view: AppView, projectId?: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  view: 'projects',
  workspaceProjectId: null,
  navigate: (view, projectId) => set({ view, workspaceProjectId: projectId ?? null }),
}))
