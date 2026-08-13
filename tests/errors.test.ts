/**
 * 错误归一化单测 —— normalizeOptimizeError 全分支 + runOptimize fallback 路径错误码保留。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { normalizeOptimizeError, OptimizeError, createOptimizer } from '../src/domain/optimizer'
import { runOptimize } from '../src/infra/worker/runOptimize'
import { createDefaultSettings } from '../src/domain/materials'
import type { Part, SheetSpec } from '../src/domain/types'
import { qty } from '../src/domain/types'

describe('normalizeOptimizeError', () => {
  it('OptimizeError → 保留 code 与 message', () => {
    const err = new OptimizeError('PART_TOO_LARGE', '零件 a 大于板材库中可用规格')
    expect(normalizeOptimizeError(err)).toEqual({
      code: 'PART_TOO_LARGE',
      message: '零件 a 大于板材库中可用规格',
    })
  })

  it('AbortError（name 判定）→ CANCELLED，message 留空（UI 不走该文案）', () => {
    const abort = new DOMException('cancelled', 'AbortError')
    expect(normalizeOptimizeError(abort)).toEqual({ code: 'CANCELLED', message: '' })
    const fake = new Error('x')
    fake.name = 'AbortError'
    expect(normalizeOptimizeError(fake)).toEqual({ code: 'CANCELLED', message: '' })
  })

  it('一般 Error → UNKNOWN + message', () => {
    expect(normalizeOptimizeError(new Error('boom'))).toEqual({ code: 'UNKNOWN', message: 'boom' })
  })

  it('非 Error 值 → UNKNOWN + String 化', () => {
    expect(normalizeOptimizeError('oops')).toEqual({ code: 'UNKNOWN', message: 'oops' })
    expect(normalizeOptimizeError(42)).toEqual({ code: 'UNKNOWN', message: '42' })
  })
})

describe('runOptimize fallback 路径（无 Worker）', () => {
  afterEach(() => vi.unstubAllGlobals())

  const sheet: SheetSpec = { id: 's1', name: '2440×1220', length: 2440, width: 1220, price: 100 }
  const settings = createDefaultSettings({ quality: 'fast', seed: 7 })

  it('业务错误码保留（与 Worker 路径对称）：PART_TOO_LARGE 不降级为 UNKNOWN', async () => {
    vi.stubGlobal('Worker', undefined)
    const parts: Part[] = [{ id: 'a', name: 'A', length: 5000, width: 300, quantity: qty(1) }]
    const got: { code?: string; message?: string } = {}
    const task = runOptimize(
      { parts, sheets: [sheet], settings },
      {
        onResult: () => {
          throw new Error('不应成功')
        },
        onError: (code, message) => {
          got.code = code
          got.message = message
        },
      },
    )
    // fallback 返回的是可取消的 AbortController 任务；等待异步完成
    await new Promise((r) => setTimeout(r, 50))
    task.cancel()
    expect(got.code).toBe('PART_TOO_LARGE')
    expect(got.message).toContain('任何方向都放不进板材库中可用规格')
    expect(got.message).toContain('「A」') // B9：报错带零件名称
  })

  it('NO_PARTS 业务码保留', async () => {
    vi.stubGlobal('Worker', undefined)
    const got: { code?: string } = {}
    runOptimize(
      { parts: [], sheets: [sheet], settings },
      {
        onResult: () => {
          throw new Error('不应成功')
        },
        onError: (code) => {
          got.code = code
        },
      },
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(got.code).toBe('NO_PARTS')
  })

  it('正常成功路径 onResult 收到方案（未在创建时同步 throw）', async () => {
    vi.stubGlobal('Worker', undefined)
    const parts: Part[] = [{ id: 'a', name: 'A', length: 400, width: 300, quantity: qty(1) }]
    const plan = await createOptimizer().optimize({ parts, sheets: [sheet], settings })
    expect(plan.sheets.length).toBe(1)
  })
})
