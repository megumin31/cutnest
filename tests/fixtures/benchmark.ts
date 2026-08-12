/**
 * 性能基准集 —— 500 零件，总面积 ≈ 22 张 2440×1220 板量级。
 * 覆盖：满长件（2440 长）/ 中小件 / 同尺寸多数量 / 旋转冲突件（grain=alongLength）。
 * 零件默认禁止旋转（grain 缺省 = alongLength），本基准集对可旋转件显式标注 grain='any'。
 * 尺寸固定硬编码，与产品逻辑解耦（架构文档 §6.2）。
 */
import type { Part, SheetSpec, OptimizeSettings } from '../../src/domain/types'
import { qty } from '../../src/domain/types'
import { createDefaultSettings } from '../../src/domain/materials'

export const BENCH_SHEET: SheetSpec = {
  id: 'bench-2440x1220',
  name: '颗粒板',
  length: 2440,
  width: 1220,
  price: 98,
}

export const BENCH_SETTINGS: OptimizeSettings = createDefaultSettings({ seed: 20260805 })

/** 500 零件（quantity 展开后），总面积 65,640,200 mm² */
export const BENCH_PARTS: Part[] = [
  // 满长件（纹理必须沿长边 → 禁止旋转）
  { id: 'p-full-400', name: '满长侧板', length: 2440, width: 400, quantity: qty(8), grain: 'alongLength' },
  { id: 'p-full-300', name: '满长横档', length: 2440, width: 300, quantity: qty(6), grain: 'alongLength' },
  { id: 'p-full-250', name: '满长踢脚', length: 2440, width: 250, quantity: qty(6), grain: 'alongLength' },
  // 大件
  { id: 'p-top-1220', name: '大台面板', length: 1220, width: 610, quantity: qty(6), grain: 'any' },
  { id: 'p-div-1000', name: '大隔板', length: 1000, width: 500, quantity: qty(8), grain: 'any' },
  { id: 'p-div-800', name: '中隔板', length: 800, width: 400, quantity: qty(22), grain: 'any' },
  // 中件（部分带纹理约束）
  { id: 'p-drw-side', name: '抽屉侧板', length: 600, width: 400, quantity: qty(20), grain: 'alongLength' },
  { id: 'p-drw-face', name: '抽屉面板', length: 500, width: 300, quantity: qty(26), grain: 'any' },
  { id: 'p-shelf-450', name: '层板', length: 450, width: 350, quantity: qty(35), grain: 'any' },
  { id: 'p-rail-400', name: '竖档', length: 400, width: 300, quantity: qty(44), grain: 'alongLength' },
  // 小件
  { id: 'p-rail-350', name: '横档', length: 350, width: 250, quantity: qty(60), grain: 'any' },
  { id: 'p-shelf-300', name: '小层板', length: 300, width: 200, quantity: qty(64), grain: 'any' },
  { id: 'p-strut-250', name: '小竖档', length: 250, width: 150, quantity: qty(75), grain: 'alongLength' },
  { id: 'p-back-200', name: '背板条', length: 200, width: 120, quantity: qty(120), grain: 'any' },
]

/** 零件总数（quantity 展开后） */
export const BENCH_PART_COUNT = BENCH_PARTS.reduce((s, p) => s + p.quantity, 0)

/** 理论最少板数（面积下界） */
export function theoreticalMinSheets(settings: OptimizeSettings = BENCH_SETTINGS): number {
  const usableLen = BENCH_SHEET.length - 2 * settings.trimAllowance
  const usableWid = BENCH_SHEET.width - 2 * settings.trimAllowance
  const total = BENCH_PARTS.reduce((s, p) => s + p.length * p.width * p.quantity, 0)
  return Math.ceil(total / (usableLen * usableWid))
}
