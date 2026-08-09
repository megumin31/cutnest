/**
 * 优化任务驱动 —— 普通函数封装 Worker 协议（发起/进度/取消），
 * 供 store 使用（不依赖 React hooks）。
 */
import { createOptimizer } from '../../domain/optimizer'
import type { OptimizeInput } from '../../domain/optimizer'
import type { CutPlan } from '../../domain/types'
import type { WorkerRequest, WorkerResponse } from './optimizer.worker'

export interface OptimizeCallbacks {
  onProgress?: (p: number) => void
  onResult: (plan: CutPlan) => void
  onError: (code: string, message: string) => void
}

export interface OptimizeTask {
  cancel: () => void
}

let jobSeq = 0

export function runOptimize(input: OptimizeInput, cb: OptimizeCallbacks): OptimizeTask {
  const jobId = `job-${Date.now()}-${++jobSeq}`

  if (typeof Worker === 'undefined') {
    // 内联回退（无 Worker 环境）
    const ac = new AbortController()
    createOptimizer()
      .optimize(input, { signal: ac.signal })
      .then((plan) => {
        plan.id = crypto.randomUUID()
        plan.createdAt = Date.now()
        cb.onProgress?.(1)
        cb.onResult(plan)
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') {
          cb.onError('CANCELLED', '已取消')
          return
        }
        cb.onError('UNKNOWN', err instanceof Error ? err.message : String(err))
      })
    return { cancel: () => ac.abort() }
  }

  const worker = new Worker(new URL('./optimizer.worker.ts', import.meta.url), { type: 'module' })
  let done = false
  worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
    const msg = ev.data
    if (msg.id !== jobId || done) return
    if (msg.type === 'progress') {
      cb.onProgress?.(msg.progress)
    } else if (msg.type === 'result') {
      done = true
      worker.terminate()
      cb.onResult(msg.plan)
    } else {
      done = true
      worker.terminate()
      cb.onError(msg.code, msg.message)
    }
  }
  worker.onerror = () => {
    if (done) return
    done = true
    worker.terminate()
    cb.onError('WORKER', '计算进程异常')
  }
  const req: WorkerRequest = { type: 'optimize', id: jobId, payload: input }
  worker.postMessage(req)

  return {
    cancel: () => {
      if (done) return
      const req: WorkerRequest = { type: 'cancel', id: jobId }
      worker.postMessage(req)
    },
  }
}
