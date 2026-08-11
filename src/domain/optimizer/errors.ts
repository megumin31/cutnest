/**
 * 计算错误归一化 —— 任意错误 → { code, message } 的唯一实现。
 * 两条执行路径（Worker 传输前 / 内联 fallback）共用：
 * 跨线程 postMessage 结构化克隆会丢失 Error 原型（接收端 instanceof 必失效），
 * 因此必须在发送边界前提取；fallback 同线程真对象，与 worker 共用同一逻辑杜绝漂移。
 */
import { OptimizeError } from './index'
import type { OptimizeErrorCode } from './index'

/** 计算任务错误码全集（业务码 + 通用码）——onError 回调 / worker 消息协议 / store.error.code 共用 */
export type ComputeErrorCode = OptimizeErrorCode | 'UNKNOWN' | 'WORKER'

export interface NormalizedError {
  code: ComputeErrorCode
  message: string
}

export function normalizeOptimizeError(err: unknown): NormalizedError {
  // 取消：AbortError（name 判定与 DOMException 一致，Node/浏览器/Worker 三端通用）
  if (err instanceof Error && err.name === 'AbortError') return { code: 'CANCELLED', message: '' }
  // 业务错误：保留 code（PART_TOO_LARGE 等），message 为 domain 硬编码文案
  if (err instanceof OptimizeError) return { code: err.code, message: err.message }
  // 一般异常：归类 UNKNOWN，保留 message
  if (err instanceof Error) return { code: 'UNKNOWN', message: err.message }
  return { code: 'UNKNOWN', message: String(err) }
}
