/**
 * 计算 Worker —— 消息协议（架构文档 §8.2）：
 * 主线程 → Worker: { type:'optimize', id, payload } | { type:'cancel', id }
 * Worker → 主线程: { type:'progress'|'result'|'error', id, ... }
 */
import { createOptimizer, OptimizeError } from '../../domain/optimizer'
import type { OptimizeInput } from '../../domain/optimizer'
import type { CutPlan } from '../../domain/types'

export interface OptimizeMessage {
  type: 'optimize'
  id: string
  payload: OptimizeInput
}

export interface CancelMessage {
  type: 'cancel'
  id: string
}

export type WorkerRequest = OptimizeMessage | CancelMessage

export interface ProgressMessage {
  type: 'progress'
  id: string
  progress: number
}

export interface ResultMessage {
  type: 'result'
  id: string
  plan: CutPlan
}

export interface ErrorMessage {
  type: 'error'
  id: string
  code: string
  message: string
}

export type WorkerResponse = ProgressMessage | ResultMessage | ErrorMessage

const controllers = new Map<string, AbortController>()
const optimizer = createOptimizer()

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data
  if (msg.type === 'cancel') {
    const c = controllers.get(msg.id)
    c?.abort()
    return
  }
  if (msg.type !== 'optimize') return

  const { id, payload } = msg
  const controller = new AbortController()
  controllers.set(id, controller)

  optimizer
    .optimize(payload, {
      onProgress: (p) => post({ type: 'progress', id, progress: p }),
      signal: controller.signal,
    })
    .then((plan) => {
      // 方案 id/createdAt 不在此分配：由 storage.savePlan 统一实体化（历史记录主键归属持久化层）
      post({ type: 'result', id, plan })
    })
    .catch((err: unknown) => {
      if (err instanceof Error && err.name === 'AbortError') {
        post({ type: 'error', id, code: 'CANCELLED', message: '已取消' })
        return
      }
      const code = err instanceof OptimizeError ? err.code : 'UNKNOWN'
      const message = err instanceof Error ? err.message : String(err)
      post({ type: 'error', id, code, message })
    })
    .finally(() => controllers.delete(id))
}

function post(msg: WorkerResponse) {
  ;(self as unknown as { postMessage: (m: WorkerResponse) => void }).postMessage(msg)
}
