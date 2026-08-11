/**
 * 项目 store —— 会话态（当前项目/零件/配置/dirty 标记）。
 * 数据实体落 storage.projects（架构文档 §4 规则 8）。
 */
import { create } from 'zustand'
import { storage } from '../../infra/storage'
import { useSettingsStore } from '../settings/settingsStore'
import type { ExportPrefs, OptimizeSettings, Part, Project, SheetSpec } from '../../domain/types'
import { DEFAULT_SHEETS, createDefaultSettings } from '../../domain/materials'

export function newId(): string {
  return crypto.randomUUID()
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
  markClean: () => void
  setDirty: () => void
}

export const useProjectStore = create<ProjectState>((set, get) => ({
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
    set({ current: project ?? null, dirty: false })
  },

  async createProject(name) {
    const project = await createProject(name)
    await storage.saveProject(project)
    set((s) => ({ projects: [project, ...s.projects], current: project, dirty: false }))
    return project
  },

  updateParts(parts) {
    const cur = get().current
    if (!cur) return
    const next = { ...cur, parts, updatedAt: Date.now() }
    set({
      current: next,
      dirty: true,
      projects: get().projects.map((p) => (p.id === cur.id ? next : p)),
    })
    void storage.saveProject(next)
  },

  addPart(part) {
    const cur = get().current
    if (!cur) return
    const next = { ...cur, parts: [...cur.parts, part], updatedAt: Date.now() }
    set({
      current: next,
      dirty: true,
      projects: get().projects.map((p) => (p.id === cur.id ? next : p)),
    })
    void storage.saveProject(next)
  },

  removePart(id) {
    const cur = get().current
    if (!cur) return
    const next = { ...cur, parts: cur.parts.filter((p) => p.id !== id), updatedAt: Date.now() }
    set({
      current: next,
      dirty: true,
      projects: get().projects.map((p) => (p.id === cur.id ? next : p)),
    })
    void storage.saveProject(next)
  },

  updateSheets(sheets) {
    const cur = get().current
    if (!cur) return
    const next = { ...cur, sheets, updatedAt: Date.now() }
    set({
      current: next,
      dirty: true,
      projects: get().projects.map((p) => (p.id === cur.id ? next : p)),
    })
    void storage.saveProject(next)
  },

  updateSettings(patch) {
    const cur = get().current
    if (!cur) return
    const next = { ...cur, settings: { ...cur.settings, ...patch }, updatedAt: Date.now() }
    set({
      current: next,
      dirty: true,
      projects: get().projects.map((p) => (p.id === cur.id ? next : p)),
    })
    void storage.saveProject(next)
  },

  updateExportPrefs(patch) {
    const cur = get().current
    if (!cur) return
    const next = { ...cur, exportPrefs: { ...cur.exportPrefs, ...patch }, updatedAt: Date.now() }
    set({
      current: next,
      dirty: true,
      projects: get().projects.map((p) => (p.id === cur.id ? next : p)),
    })
    void storage.saveProject(next)
  },

  renameProject(id, name) {
    const cur = get().projects.find((p) => p.id === id)
    if (!cur) return
    const next = { ...cur, name, updatedAt: Date.now() }
    set({
      current: get().current?.id === id ? next : get().current,
      projects: get().projects.map((p) => (p.id === id ? next : p)),
    })
    void storage.saveProject(next)
  },

  async deleteProject(id) {
    await storage.deleteProject(id)
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      current: s.current?.id === id ? null : s.current,
    }))
  },

  markClean() {
    set({ dirty: false })
  },
  setDirty() {
    set({ dirty: true })
  },
}))
