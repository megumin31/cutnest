/**
 * 项目 store —— 会话态（当前项目/零件/配置/dirty 标记）。
 * 数据实体落 storage.projects（架构文档 §4 规则 8）。
 */
import { create } from 'zustand'
import { storage } from '../../infra/storage'
import { useSettingsStore } from '../settings/settingsStore'
import { usePlanStore } from '../cutting/planStore'
import { inputMatches } from '../cutting/planFingerprint'
import type { ExportPrefs, OptimizeSettings, Part, Project, SheetSpec } from '../../domain/types'
import { DEFAULT_SHEETS, createDefaultSettings } from '../../domain/materials'

export function newId(): string {
  return crypto.randomUUID()
}

/** 持久化防抖：连击编辑只写最后一次（拖尾 500ms），避免每键击全量写 IndexedDB 卡顿 */
const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>()
const SAVE_DEBOUNCE_MS = 500

function scheduleSave(project: Project) {
  const pending = pendingSaves.get(project.id)
  if (pending) clearTimeout(pending)
  pendingSaves.set(
    project.id,
    setTimeout(() => {
      pendingSaves.delete(project.id)
      void storage.saveProject(project)
    }, SAVE_DEBOUNCE_MS),
  )
}

function cancelPendingSave(projectId: string) {
  const pending = pendingSaves.get(projectId)
  if (pending) {
    clearTimeout(pending)
    pendingSaves.delete(projectId)
  }
}

/**
 * dirty 派生（非开关变量）：当前项目输入指纹 ≠ 当前展示方案对应的输入指纹。
 * 方案记录"由哪份输入算出"（planStore.inputFingerprint），比较得出——
 * 计算失败/取消时指纹仍是旧方案的 → 零件已改仍会提示；
 * fp=null（无方案/历史方案/reset）→ 无"由当前输入算出的方案"可比 → 不算 dirty。
 */
function recomputeDirty(current: Project | null): boolean {
  if (!current) return false
  const fp = usePlanStore.getState().inputFingerprint
  if (fp === null) return false
  return !inputMatches(current, fp)
}

export async function createProject(name: string, existing?: Partial<Project>): Promise<Project> {
  const now = Date.now()
  // 应用设置页的默认板材库 / 切缝 / 修边（默认库 = 内置规格 + 自定义材料，按 id 去重）
  const prefs = useSettingsStore.getState().settings
  const custom = await storage.listMaterials()
  const allSheets = [...custom, ...DEFAULT_SHEETS]
  const byId = new Map(allSheets.map((s) => [s.id, s]))
  const sheetIds = prefs.defaultSheetIds?.length ? prefs.defaultSheetIds : [DEFAULT_SHEETS[0].id]
  const sheets = sheetIds
    .map((id) => byId.get(id))
    .filter((s): s is SheetSpec => s !== undefined)
  const settings = createDefaultSettings({
    ...(prefs.kerf !== undefined ? { kerf: prefs.kerf } : {}),
    ...(prefs.trim !== undefined ? { trimAllowance: prefs.trim } : {}),
  })
  return {
    id: newId(),
    name,
    parts: [],
    sheets: sheets.length > 0 ? sheets : [DEFAULT_SHEETS[0]],
    settings,
    exportPrefs: {
      pdf: { watermark: { enabled: false, text: '' }, companyInfo: { name: '' } },
      dxf: { cutDirection: 'climb' },
      unit: 'mm',
    },
    createdAt: now,
    updatedAt: now,
    ...existing,
  }
}

interface ProjectState {
  projects: Project[]
  current: Project | null
  dirty: boolean
  loaded: boolean
  loadProjects: () => Promise<void>
  openProject: (id: string) => Promise<void>
  createProject: (name: string) => Promise<Project>
  updateParts: (parts: Part[]) => void
  addPart: (part: Part) => void
  removePart: (id: string) => void
  updateSheets: (sheets: SheetSpec[]) => void
  updateSettings: (patch: Partial<OptimizeSettings>) => void
  updateExportPrefs: (patch: Partial<ExportPrefs>) => void
  renameProject: (id: string, name: string) => void
  deleteProject: (id: string) => Promise<void>
}

export const useProjectStore = create<ProjectState>((set, get) => {
  // dirty 派生联动：方案输入指纹变化（计算成功/打开历史/reset）时重算——
  // 否则成功落方案后 projectStore.dirty 仍停留在计算前的 true（本 store 的变更动作不会触发重算）
  usePlanStore.subscribe((s, prev) => {
    if (s.inputFingerprint !== prev.inputFingerprint) {
      set({ dirty: recomputeDirty(get().current) })
    }
  })
  return {
    projects: [],
    current: null,
    dirty: false,
    loaded: false,

  async loadProjects() {
    const projects = await storage.listProjects()
    set({ projects, loaded: true })
  },

  async openProject(id) {
    const project = await storage.getProject(id)
    set({ current: project ?? null, dirty: recomputeDirty(project ?? null) })
  },

  async createProject(name) {
    const project = await createProject(name)
    await storage.saveProject(project)
    set((s) => ({ projects: [project, ...s.projects], current: project, dirty: recomputeDirty(project) }))
    return project
  },

  updateParts(parts) {
    const cur = get().current
    if (!cur) return
    const next = { ...cur, parts, updatedAt: Date.now() }
    set({
      current: next,
      dirty: recomputeDirty(next),
      projects: get().projects.map((p) => (p.id === cur.id ? next : p)),
    })
    scheduleSave(next)
  },

  addPart(part) {
    const cur = get().current
    if (!cur) return
    const next = { ...cur, parts: [...cur.parts, part], updatedAt: Date.now() }
    set({
      current: next,
      dirty: recomputeDirty(next),
      projects: get().projects.map((p) => (p.id === cur.id ? next : p)),
    })
    scheduleSave(next)
  },

  removePart(id) {
    const cur = get().current
    if (!cur) return
    const next = { ...cur, parts: cur.parts.filter((p) => p.id !== id), updatedAt: Date.now() }
    set({
      current: next,
      dirty: recomputeDirty(next),
      projects: get().projects.map((p) => (p.id === cur.id ? next : p)),
    })
    scheduleSave(next)
  },

  updateSheets(sheets) {
    const cur = get().current
    if (!cur) return
    const next = { ...cur, sheets, updatedAt: Date.now() }
    set({
      current: next,
      dirty: recomputeDirty(next),
      projects: get().projects.map((p) => (p.id === cur.id ? next : p)),
    })
    scheduleSave(next)
  },

  updateSettings(patch) {
    const cur = get().current
    if (!cur) return
    const next = { ...cur, settings: { ...cur.settings, ...patch }, updatedAt: Date.now() }
    set({
      current: next,
      dirty: recomputeDirty(next),
      projects: get().projects.map((p) => (p.id === cur.id ? next : p)),
    })
    scheduleSave(next)
  },

  updateExportPrefs(patch) {
    const cur = get().current
    if (!cur) return
    const next = { ...cur, exportPrefs: { ...cur.exportPrefs, ...patch }, updatedAt: Date.now() }
    set({
      current: next,
      dirty: recomputeDirty(next),
      projects: get().projects.map((p) => (p.id === cur.id ? next : p)),
    })
    scheduleSave(next)
  },

  renameProject(id, name) {
    const cur = get().projects.find((p) => p.id === id)
    if (!cur) return
    const next = { ...cur, name, updatedAt: Date.now() }
    const updatedCurrent = get().current?.id === id ? next : get().current
    set({
      current: updatedCurrent,
      dirty: recomputeDirty(updatedCurrent),
      projects: get().projects.map((p) => (p.id === id ? next : p)),
    })
    scheduleSave(next)
  },

  async deleteProject(id) {
    cancelPendingSave(id)
    await storage.deleteProject(id)
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      current: s.current?.id === id ? null : s.current,
      dirty: recomputeDirty(s.current?.id === id ? null : s.current),
    }))
  },
  }
})
