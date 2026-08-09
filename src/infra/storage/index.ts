/**
 * 本地持久化 —— Dexie (IndexedDB)，Web 与 Tauri webview 通用（架构文档 §8.1）。
 * 表：projects / cutPlans / materials / settings / auth。
 * schema 变更必须走 Dexie version + migrate 函数，禁止直接改表。
 */
import Dexie, { type Table } from 'dexie'
import type { Project, PlanRecord, SheetSpec, Quality, OptimizeSettings } from '../../domain/types'

export interface SettingsRow {
  key: string
  value: unknown
}

export interface AuthRow {
  key: 'session'
  value: unknown
}

class Cut3Db extends Dexie {
  projects!: Table<Project, string>
  cutPlans!: Table<PlanRecord, string>
  materials!: Table<SheetSpec, string>
  settings!: Table<SettingsRow, string>
  auth!: Table<AuthRow, string>

  constructor() {
    super('cut3')
    // v1 初始 schema；后续版本在此追加 version(n).upgrade(migrate)
    this.version(1).stores({
      projects: 'id, updatedAt, createdAt',
      cutPlans: 'id, projectId, createdAt',
      materials: 'id',
      settings: 'key',
      auth: 'key',
    })
    // v2：板材库（v1.1）—— project.sheet(单) → project.sheets(数组)；cutPlans.sheet → sheets
    this.version(2).upgrade((tx) => {
      return tx
        .table('projects')
        .toCollection()
        .modify((p: Project) => {
          const old = p as Project & { sheet?: SheetSpec }
          if (old.sheet && !Array.isArray((p as { sheets?: unknown }).sheets)) {
            ;(p as unknown as { sheets: SheetSpec[] }).sheets = [old.sheet]
            delete (old as { sheet?: unknown }).sheet
          }
        })
        .then(() =>
          tx
            .table('cutPlans')
            .toCollection()
            .modify((r: PlanRecord) => {
              const old = r as PlanRecord & { sheet?: SheetSpec }
              if (old.sheet && !Array.isArray((r as { sheets?: unknown }).sheets)) {
                ;(r as unknown as { sheets: SheetSpec[] }).sheets = [old.sheet]
                delete (old as { sheet?: unknown }).sheet
              }
            }),
        )
    })
    // v3：计算质量（v1.1）—— settings.timeLimitMs(ms) → settings.quality(三档)
    this.version(3).upgrade((tx) => {
      return tx
        .table('projects')
        .toCollection()
        .modify((p: Project) => {
          const s = p.settings as OptimizeSettings & { timeLimitMs?: number }
          if (s && typeof (s as { quality?: unknown }).quality === 'undefined') {
            const ms = s.timeLimitMs ?? 5000
            ;(s as { quality?: Quality }).quality = ms <= 3000 ? 'fast' : ms <= 8000 ? 'standard' : 'fine'
            delete (s as { timeLimitMs?: number }).timeLimitMs
          }
        })
    })
  }
}

export const db = new Cut3Db()

export interface StorageApi {
  listProjects(): Promise<Project[]>
  getProject(id: string): Promise<Project | undefined>
  saveProject(project: Project): Promise<void>
  deleteProject(id: string): Promise<void>
  listPlans(projectId: string): Promise<PlanRecord[]>
  savePlan(record: PlanRecord): Promise<void>
  deletePlan(id: string): Promise<void>
  listMaterials(): Promise<SheetSpec[]>
  saveMaterial(spec: SheetSpec): Promise<void>
  deleteMaterial(id: string): Promise<void>
  getSetting<T>(key: string): Promise<T | undefined>
  setSetting<T>(key: string, value: T): Promise<void>
  getAuth(): Promise<unknown | undefined>
  setAuth(value: unknown): Promise<void>
}

export const storage: StorageApi = {
  async listProjects() {
    return db.projects.orderBy('updatedAt').reverse().toArray()
  },
  async getProject(id) {
    return db.projects.get(id)
  },
  async saveProject(project) {
    await db.projects.put(project)
  },
  async deleteProject(id) {
    await db.transaction('rw', [db.projects, db.cutPlans], async () => {
      await db.projects.delete(id)
      await db.cutPlans.where('projectId').equals(id).delete()
    })
  },
  async listPlans(projectId) {
    return db.cutPlans.where('projectId').equals(projectId).reverse().sortBy('createdAt')
  },
  async savePlan(record) {
    await db.cutPlans.put(record)
  },
  async deletePlan(id) {
    await db.cutPlans.delete(id)
  },
  async listMaterials() {
    return db.materials.toArray()
  },
  async saveMaterial(spec) {
    await db.materials.put(spec)
  },
  async deleteMaterial(id) {
    await db.materials.delete(id)
  },
  async getSetting<T>(key: string) {
    const row = await db.settings.get(key)
    return row?.value as T | undefined
  },
  async setSetting<T>(key: string, value: T) {
    await db.settings.put({ key, value })
  },
  async getAuth() {
    const row = await db.auth.get('session')
    return row?.value
  },
  async setAuth(value: unknown) {
    if (value === null) {
      await db.auth.delete('session')
    } else {
      await db.auth.put({ key: 'session', value })
    }
  },
}
