/**
 * optimizer 单测 —— 小用例（含已知最优解）+ 边界 + 确定性。
 */
import { describe, it, expect } from 'vitest'
import { createOptimizer, usableArea } from '../src/domain/optimizer'
import { iterationBudget } from '../src/domain/optimizer/search'
import { validatePlan } from '../src/domain/optimizer/validator'
import { evaluatePlan, compareScores, wasteRegionsOfLayout } from '../src/domain/optimizer/evaluate'
import type { PackedSheet, PackItem } from '../src/domain/optimizer/stripPacker'
import type { Part, SheetSpec, OptimizeSettings } from '../src/domain/types'
import { qty } from '../src/domain/types'
import { createDefaultSettings } from '../src/domain/materials'

const sheet: SheetSpec = { id: 's1', name: '2440×1220', length: 2440, width: 1220, price: 100 }
/** 小规格板材（多板材用例用） */
const sheetSmall: SheetSpec = { id: 's2', name: '1200×600', length: 1200, width: 600, price: 40 }

/** 3+ 处调用点共用的测试设置工厂 */
function settings(overrides?: Partial<OptimizeSettings>): OptimizeSettings {
  return createDefaultSettings({ quality: 'fast', seed: 7, ...overrides })
}

async function run(parts: Part[], s: OptimizeSettings = settings(), sheets: SheetSpec[] = [sheet]) {
  return createOptimizer().optimize({ parts, sheets, settings: s })
}

describe('optimizer 基础排样', () => {
  it('两个零件排入一张板，全部出现且过校验', async () => {
    const parts: Part[] = [
      { id: 'a', name: 'A', length: 1000, width: 500, quantity: qty(1) },
      { id: 'b', name: 'B', length: 800, width: 400, quantity: qty(1) },
    ]
    const plan = await run(parts)
    expect(plan.sheets.length).toBe(1)
    expect(plan.sheets[0].placements.length).toBe(2)
    expect(validatePlan(plan, parts, [sheet], settings()).ok).toBe(true)
    expect(plan.stats.utilization).toBeGreaterThan(20)
  })

  it('同尺寸多数量：数量展开正确', async () => {
    const parts: Part[] = [{ id: 'a', name: 'A', length: 400, width: 300, quantity: qty(12) }]
    const plan = await run(parts)
    const total = plan.sheets.reduce((s, sh) => s + sh.placements.length, 0)
    expect(total).toBe(12)
    // 400×300：每行 4 个（含 3mm 切缝）→ 每张板 4 行 × 4 列 = 16 个，12 个 → 1 张
    expect(plan.sheets.length).toBe(1)
  })

  it('数量=0 的零件不出现', async () => {
    const parts: Part[] = [
      { id: 'a', name: 'A', length: 400, width: 300, quantity: qty(0) },
      { id: 'b', name: 'B', length: 400, width: 300, quantity: qty(2) },
    ]
    const plan = await run(parts)
    const ids = plan.sheets.flatMap((sh) => sh.placements.map((p) => p.partId))
    expect(ids).not.toContain('a')
    expect(ids.filter((x) => x === 'b').length).toBe(2)
  })

  it('qty 截断后的数量正确展开（2.9→2）', async () => {
    const parts: Part[] = [{ id: 'a', name: 'A', length: 400, width: 300, quantity: qty(2.9) }]
    const plan = await run(parts)
    const total = plan.sheets.reduce((s, sh) => s + sh.placements.length, 0)
    expect(total).toBe(2)
    expect(validatePlan(plan, parts, [sheet], settings()).ok).toBe(true)
  })

  it('空输入报 NO_PARTS', async () => {
    await expect(run([])).rejects.toMatchObject({ code: 'NO_PARTS' })
  })

  it('超大零件报 PART_TOO_LARGE', async () => {
    const parts: Part[] = [{ id: 'big', name: '大', length: 3000, width: 1000, quantity: qty(1) }]
    await expect(run(parts)).rejects.toMatchObject({ code: 'PART_TOO_LARGE' })
  })

  it('修边余量生效：可用区域缩小', () => {
    const u0 = usableArea(sheet, settings({ trimAllowance: 0 }))
    const u1 = usableArea(sheet, settings({ trimAllowance: 10 }))
    expect(u1.len).toBe(u0.len - 20)
    expect(u1.wid).toBe(u0.wid - 20)
  })

  it('相邻零件净距 ≥ kerf（=3）', async () => {
    const parts: Part[] = [
      { id: 'a', name: 'A', length: 1000, width: 1000, quantity: qty(2) },
      { id: 'b', name: 'B', length: 200, width: 200, quantity: qty(1) },
    ]
    const plan = await run(parts)
    const ps = plan.sheets[0].placements
    const a0 = ps.find((p) => p.partId === 'a' && p.instance === 0)!
    const a1 = ps.find((p) => p.partId === 'a' && p.instance === 1)!
    // 两矩形轴向投影间隙 ≥ kerf（同一轴投影不重叠即满足）
    const gx = Math.max(a0.x, a1.x) - Math.min(a0.x + a0.len, a1.x + a1.len)
    const gy = Math.max(a0.y, a1.y) - Math.min(a0.y + a0.wid, a1.y + a1.wid)
    expect(Math.max(gx, gy)).toBeCloseTo(3, 5)
    expect(validatePlan(plan, parts, [sheet], settings()).ok).toBe(true)
  })

  it('stats 含零件总面积与封边米数（排样快照）', async () => {
    const parts: Part[] = [
      { id: 'a', name: 'A', length: 1200, width: 400, quantity: qty(2), edgeBand: ['L', 'R'] },
      { id: 'b', name: 'B', length: 600, width: 300, quantity: qty(1) },
    ]
    const plan = await run(parts, settings())
    // 零件总面积 = Σ 已排入实例面积（mm²）
    const placed = plan.sheets.flatMap((s) => s.placements)
    const area = placed.reduce((s, p) => s + p.len * p.wid, 0)
    expect(plan.stats.partArea).toBe(area)
    // a：L+R 封边 = 2×400mm = 0.8m/块 × 2 块 = 1.6m；b 无封边
    expect(plan.stats.edgeMeters).toBeCloseTo(1.6, 6)
  })

  it('旋转封边件的 edgeMeters 按未旋转尺寸统计（方向标签语义）', async () => {
    const parts: Part[] = [
      { id: 'a', name: 'A', length: 2000, width: 500, quantity: qty(8), grain: 'any', edgeBand: ['L', 'R'] },
      { id: 'b', name: 'B', length: 900, width: 600, quantity: qty(14), grain: 'any', edgeBand: ['T', 'B'] },
      { id: 'c', name: 'C', length: 600, width: 400, quantity: qty(30), grain: 'any', edgeBand: ['L'] },
    ]
    const plan = await run(parts, settings({ seed: 1 }))
    // a：L/R 宽度方向 2×500×8 = 8000mm；b：T/B 长度方向 2×900×14 = 25200mm；c：L 宽度方向 400×30 = 12000mm
    expect(plan.stats.edgeMeters).toBeCloseTo(45.2, 6)
    // 用例确实覆盖旋转路径（seed=1 时该零件集存在旋转实例）
    const rotated = plan.sheets.flatMap((s) => s.placements).some((p) => p.rotated)
    expect(rotated).toBe(true)
  })

  it('价格核算关闭时仍计算两种计价模式成本（开关只影响展示）', async () => {
    const parts: Part[] = [
      { id: 'a', name: 'A', length: 2000, width: 1000, quantity: qty(1), edgeBand: ['T', 'B'] },
    ]
    const pricing = {
      enabled: false,
      mode: 'itemized' as const,
      edgePricePerM: 2,
      processingFeePerSheet: 15,
      areaPricePerSqm: 120,
    }
    const plan = await createOptimizer().optimize({ parts, sheets: [sheet], settings: settings(), pricing })
    // itemized：板费 100 + 封边 2×2m×2 元 + 加工费 15 = 100 + 8 + 15 = 123
    expect(plan.stats.costItemized).toBeCloseTo(123, 5)
    // byArea：2 m² × 120 = 240
    expect(plan.stats.costByArea).toBeCloseTo(240, 5)
    // totalCost = 计算时 mode（itemized）的值
    expect(plan.stats.totalCost).toBe(plan.stats.costItemized)
  })
})

describe('旋转约束', () => {
  it('grain=alongLength 的零件禁止旋转', async () => {
    const parts: Part[] = [
      { id: 'a', name: '长条', length: 2400, width: 200, quantity: qty(1), grain: 'alongLength' },
      { id: 'b', name: 'B', length: 500, width: 500, quantity: qty(1), grain: 'any' },
    ]
    const plan = await run(parts, settings())
    const a = plan.sheets.flatMap((s) => s.placements).find((p) => p.partId === 'a')!
    expect(a.rotated).toBe(false)
    expect(a.len).toBe(2400)
  })

  it('grain 缺省的零件默认禁止旋转', async () => {
    const parts: Part[] = [{ id: 'a', name: 'A', length: 1000, width: 600, quantity: qty(1) }]
    const plan = await run(parts, settings({ quality: 'fast' }))
    const a = plan.sheets.flatMap((s) => s.placements).find((p) => p.partId === 'a')!
    expect(a.rotated).toBe(false)
    expect(a.len).toBe(1000)
    expect(validatePlan(plan, parts, [sheet], settings()).ok).toBe(true)
  })
})

describe('多板材排样', () => {
  it('开新板选最小能装下的规格：大件开大板、小件开小板', async () => {
    const parts: Part[] = [
      { id: 'big', name: '大件', length: 2000, width: 1000, quantity: qty(1) },
      { id: 'small', name: '小件', length: 800, width: 400, quantity: qty(1) },
    ]
    const plan = await run(parts, settings(), [sheet, sheetSmall])
    expect(plan.sheets.length).toBe(2)
    const specs = plan.sheets.map((s) => s.sheetSpecId).sort()
    // 大件只能进 2440×1220；小件进 1200×600（能装下且面积最小）
    expect(specs).toEqual(['s1', 's2'])
    const smallSheet = plan.sheets.find((s) => s.sheetSpecId === 's2')!
    expect(smallSheet.placements[0].partId).toBe('small')
    expect(validatePlan(plan, parts, [sheet, sheetSmall], settings()).ok).toBe(true)
  })

  it('指定板材的零件开指定规格的板；任意件可混入', async () => {
    const parts: Part[] = [
      { id: 'a', name: '指定件', length: 700, width: 400, quantity: qty(1), sheetId: 's2' },
      { id: 'b', name: '任意件', length: 400, width: 300, quantity: qty(1) },
    ]
    const plan = await run(parts, settings(), [sheet, sheetSmall])
    // 指定件定板型：s2 板；任意件混入同一张板
    expect(plan.sheets.length).toBe(1)
    expect(plan.sheets[0].sheetSpecId).toBe('s2')
    expect(plan.sheets[0].placements.length).toBe(2)
    expect(validatePlan(plan, parts, [sheet, sheetSmall], settings()).ok).toBe(true)
  })

  it('指定规格放不下当前零件时报 PART_TOO_LARGE', async () => {
    const parts: Part[] = [
      { id: 'a', name: '大件', length: 1300, width: 700, quantity: qty(1), sheetId: 's2' },
    ]
    await expect(run(parts, settings(), [sheet, sheetSmall])).rejects.toMatchObject({ code: 'PART_TOO_LARGE' })
  })
})

describe('确定性', () => {
  it('同输入两次运行结果完全一致', async () => {
    const parts: Part[] = [
      { id: 'a', name: 'A', length: 1200, width: 600, quantity: qty(3) },
      { id: 'b', name: 'B', length: 800, width: 400, quantity: qty(5) },
      { id: 'c', name: 'C', length: 300, width: 200, quantity: qty(8) },
    ]
    const s = settings()
    const p1 = await run(parts, s)
    const p2 = await run(parts, s)
    expect(JSON.stringify(p1)).toBe(JSON.stringify(p2))
  })

  it('不同 seed 结果都合法', async () => {
    const parts: Part[] = [
      { id: 'a', name: 'A', length: 1200, width: 600, quantity: qty(3) },
      { id: 'b', name: 'B', length: 800, width: 400, quantity: qty(5) },
    ]
    for (const seed of [1, 2]) {
      const s = settings({ seed })
      const plan = await run(parts, s)
      expect(validatePlan(plan, parts, [sheet], s).ok).toBe(true)
    }
  })
})

describe('取消', () => {
  it('预先中止的 signal 立即拒绝', async () => {
    const parts: Part[] = Array.from({ length: 40 }, (_, i) => ({
      id: `p${i}`,
      name: `P${i}`,
      length: 200 + (i % 5) * 60,
      width: 150 + (i % 4) * 50,
      quantity: qty(2),
    }))
    const ac = new AbortController()
    ac.abort()
    const s = settings({ quality: 'fine' })
    await expect(createOptimizer().optimize({ parts, sheets: [sheet], settings: s }, { signal: ac.signal })).rejects.toMatchObject(
      { name: 'AbortError' },
    )
  })

  it('进度回调单调递增到 1', async () => {
    const parts: Part[] = [{ id: 'a', name: 'A', length: 400, width: 300, quantity: qty(6) }]
    const s = settings()
    const seen: number[] = []
    await createOptimizer().optimize({ parts, sheets: [sheet], settings: s }, { onProgress: (p) => seen.push(p) })
    expect(seen.length).toBeGreaterThan(0)
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
    expect(seen[seen.length - 1]).toBeGreaterThan(0.9)
  })
})

describe('迭代预算（quality 强度锚定）', () => {
  it('迭代数 = 每零件迭代数 × 零件数：零件多寡时强度一致', () => {
    // 标准档 2.4 次/零件：500 零件 → 1200 次
    expect(iterationBudget('standard', 500)).toBe(1200)
    // 快速 1.2 / 精细 7 次/零件
    expect(iterationBudget('fast', 500)).toBe(600)
    expect(iterationBudget('fine', 500)).toBe(3500)
    // 零件翻倍 → 迭代翻倍（强度不变，耗时自然增长）
    expect(iterationBudget('standard', 1000)).toBe(2400)
    // 下限保护：小规模至少 200 次（小项目快速完成且质量保底）
    expect(iterationBudget('standard', 10)).toBe(200)
    expect(iterationBudget('standard', 0)).toBe(200)
    // 上限保护：超大项目限制单次计算总量
    expect(iterationBudget('fine', 100000)).toBe(6000)
  })
})

describe('评价函数字典序（已知最优解小用例）', () => {
  it('能用更少张板时绝不选更多张', async () => {
    // 4 个 1200×600：2×2 正好一张板（2406×1206 ≤ 2440×1220）→ 最优 1 张
    const parts: Part[] = [{ id: 'a', name: 'A', length: 1200, width: 600, quantity: qty(4) }]
    const plan = await run(parts, settings({ quality: 'fine' }))
    expect(plan.stats.sheetCount).toBe(1)
  })

  it('铺满 2 张板：无余料、无可再利用块', async () => {
    // 600×400：每行 4 个（2412 ≤ 2440）、3 行（1209 ≤ 1220）→ 每张板 12 个
    const parts: Part[] = [{ id: 'a', name: 'A', length: 600, width: 400, quantity: qty(24) }]
    const plan = await run(parts)
    expect(plan.stats.sheetCount).toBe(2)
    expect(plan.stats.reusableWasteBlocks).toBe(0)
  })

  it('余料条带底部紧贴零件顶部（无 kerf 白色缝隙）', () => {
    // 2 个 1000×500 并排（槽 1003×503）→ 槽顶 y=503，真实零件顶 500
    // 余料条带应从 y=500 画到板顶 1220（中间不得留 kerf 白缝）
    const usableLen = 2440
    const usableWid = 1220
    const kerf = 3
    const regions = wasteRegionsOfLayout(
      [
        { x: 0, y: 0, len: 1000, wid: 500 },
        { x: 1003, y: 0, len: 1000, wid: 500 },
      ],
      usableLen,
      usableWid,
      kerf,
    )
    const coverStrips = regions.flatMap((r) => r.strips.filter((s) => s.x < 2006))
    expect(coverStrips.length).toBeGreaterThan(0)
    for (const s of coverStrips) {
      expect(s.y).toBeCloseTo(500, 5) // 条带底 = 零件真实顶
      expect(s.y + s.h).toBeCloseTo(1220, 5) // 条带顶 = 板顶（渲染裁剪后无缺失）
    }
  })

  it('同类聚排优先于余料块数：同零件贴在一起的方案胜出', () => {
    // 方案 A：同类零件并排相邻（共享边 303mm×2 板），但余料碎成 2 块
    // 方案 B：同类零件分散（无共享边），但余料只有 1 块
    // 字典序 ② 同类聚排 → A 应胜（尽管 B 的块数更少）
    const mkItem = (partId: string): PackItem => ({ partId, instance: 0, slotLen: 403, slotWid: 303, len: 400, wid: 300, rotated: false })
    const sheetA = (): PackedSheet => ({
      sheetSpecId: 's1',
      placements: [
        { item: mkItem('a'), x: 0, y: 0 },
        { item: mkItem('a'), x: 403, y: 0 },
      ],
      skyline: [
        { x: 0, y: 303, w: 806 },
        { x: 806, y: 0, w: 1600 },
      ],
      slotLen: 2443,
      slotWid: 1223,
    })
    const groupedA: PackedSheet[] = [sheetA(), sheetA()]
    const scatteredB: PackedSheet[] = [
      {
        sheetSpecId: 's1',
        placements: [{ item: mkItem('a'), x: 0, y: 0 }],
        skyline: [
          { x: 0, y: 303, w: 403 },
          { x: 403, y: 0, w: 2000 },
        ],
        slotLen: 2443,
        slotWid: 1223,
      },
      // 第二板余料全高 100：无 ≥200×200 的余料块
      {
        sheetSpecId: 's1',
        placements: [{ item: mkItem('a'), x: 0, y: 0 }],
        skyline: [{ x: 0, y: 1123, w: 2400 }],
        slotLen: 2443,
        slotWid: 1223,
      },
    ]
    const scoreA = evaluatePlan({ sheets: groupedA }, 200)
    const scoreB = evaluatePlan({ sheets: scatteredB }, 200)
    expect(scoreA.compactness).toBeLessThan(scoreB.compactness)
    expect(scoreA.reusableWasteBlocks).toBeGreaterThan(scoreB.reusableWasteBlocks)
    // 同类聚排层应盖过块数层
    expect(compareScores(scoreA, scoreB)).toBeGreaterThan(0)
  })
})
