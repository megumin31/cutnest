/**
 * 性能基准测试（架构文档 §6.2）—— 四条件同时满足：
 * 1. 时间 <15s   2. 利用率 ≥ 85%   3. 确定性   4. 完整性 + 过 validator
 * 张数作为 sanity check（落在 fixture 设计区间内），不是硬约束。
 */
import { describe, it, expect } from 'vitest'
import { createOptimizer } from '../src/domain/optimizer'
import { validatePlan } from '../src/domain/optimizer/validator'
import { DEFAULT_PRICING } from '../src/domain/pricing'
import { BENCH_PARTS, BENCH_SHEET, BENCH_SETTINGS, BENCH_PART_COUNT } from './fixtures/benchmark'

describe('500 零件基准', () => {
  it('四条件验收：时间 / 利用率 / 确定性 / 完整性', async () => {
    const settings = BENCH_SETTINGS
    const optimizer = createOptimizer()
    // 成本核算集成：加工费置 0，总成本 = 张数 × 单价（曾因 sheets 组装时序错误回填 0）
    const pricing = { ...DEFAULT_PRICING, processingFeePerSheet: 0 }

    const t0 = performance.now()
    const plan = await optimizer.optimize({ parts: BENCH_PARTS, sheets: [BENCH_SHEET], settings, pricing })
    const elapsed = performance.now() - t0

    // 1. 时间
    expect(elapsed).toBeLessThan(15_000)

    // 2. 利用率
    expect(plan.stats.utilization).toBeGreaterThanOrEqual(85)

    // 3. 确定性：同输入再次运行完全一致
    const plan2 = await optimizer.optimize({ parts: BENCH_PARTS, sheets: [BENCH_SHEET], settings, pricing })
    expect(JSON.stringify(plan2)).toBe(JSON.stringify(plan))

    // 4. 完整性 + validator
    expect(BENCH_PART_COUNT).toBe(500)
    const placed = plan.sheets.reduce((s, sh) => s + sh.placements.length, 0)
    expect(placed).toBe(BENCH_PART_COUNT)
    const v = validatePlan(plan, BENCH_PARTS, [BENCH_SHEET], settings)
    expect(v.ok).toBe(true)

    // 成本核算集成：总成本 = 张数 × 单价（曾因 sheets 组装时序错误回填 0）
    expect(plan.stats.totalCost).toBeCloseTo(plan.stats.sheetCount * BENCH_SHEET.price, 5)

    // sanity：张数落在理论最优 ± 25% 内
    const minSheets = Math.ceil(
      BENCH_PARTS.reduce((s, p) => s + p.length * p.width * p.quantity, 0) /
        (BENCH_SHEET.length * BENCH_SHEET.width),
    )
    expect(plan.stats.sheetCount).toBeGreaterThanOrEqual(minSheets)
    expect(plan.stats.sheetCount).toBeLessThanOrEqual(Math.ceil(minSheets * 1.25))

    // B1 修复红利锚点（2026-08-13）：packer 保证性 fallback 打开"旋转填侧洞"搜索空间后，
    // 基准张数从 25 降到 24——字典序第①层"张数最少"是产品价值观，
    // 若未来回归到 >25 说明搜索空间退化（本锚点同时作为新基线记录）
    expect(plan.stats.sheetCount).toBeLessThanOrEqual(25)

    // 兜底：即使断言失败也输出基准数据供分析
    console.log(
      `[benchmark] ${elapsed.toFixed(0)}ms | ${plan.stats.sheetCount} 张 | 利用率 ${plan.stats.utilization.toFixed(2)}% | 可再利用块 ${plan.stats.reusableWasteBlocks} | 最大块 ${plan.stats.largestReusableWaste.toLocaleString()} mm²`,
    )
  })
})
