/**
 * 模拟退火 + 迭代局部搜索（ILS）——
 * 扰动（交换/单件旋转/移动/整组旋转/整组移动）+ 固定种子 + 固定迭代预算。
 *
 * 结构：多初始序取优 → 退火细化 → 周期"踢"（大范围整段重排）再细化，
 * 每次细化后更新全局最优。多 seed 并行由调用方组合（确定性 seed 派生）。
 * 接受判定按字典序分层：板数层硬规则（多板永不接受），同板数下紧凑度层用毫米温度退火，
 * 块数/最大块层用 compareScores 精确比较 —— 温度只放松布局整齐度，不放松板数。
 *
 * 确定性保证：迭代次数由 settings.quality 派生（与机器速度无关），
 * 全部随机性来自 mulberry32(seed)，不读时钟 —— 同输入两次运行结果完全一致。
 */
import { mulberry32, randInt, type Rng } from './rng'
import { packSequence, type PackItem, type PackResult, type SheetLibraryEntry } from './stripPacker'
import { evaluatePlan, compareScores, type EvalScore } from './evaluate'
import { QUALITY_PART_ITER } from '../materials'
import { EPSILON, type Quality } from '../types'

export interface SearchInstance extends PackItem {
  /** 是否允许旋转（grain==='any'） */
  rotatable: boolean
  /** 未旋转时槽长/槽宽 */
  baseSlotLen: number
  baseSlotWid: number
  baseLen: number
  baseWid: number
}

export interface SearchParams {
  instances: SearchInstance[]
  /** 板材库（可用区，trim 已扣除） */
  library: SheetLibraryEntry[]
  kerf: number
  minReusableWaste: number
  iterations: number
  seed: number
  onProgress?: (p: number) => void
  signal?: AbortSignal
}

export interface SearchOutcome {
  result: PackResult
  score: EvalScore
}

/**
 * 派生迭代预算：按零件规模锚定「每零件迭代数」（搜索强度与零件数无关）。
 * 快速/标准/精细 = 1.2/2.4/7 次迭代/零件；总耗时随零件数自然增长（单次重排 ≈ n²×1.76e-5 ms）。
 * 下限 200 / 上限 6000 保护（小项目快速完成、超大项目限制单次计算总量）。
 */
export function iterationBudget(quality: Quality, instanceCount: number): number {
  const perPart = QUALITY_PART_ITER[quality]
  return Math.min(6000, Math.max(200, Math.round(perPart * instanceCount)))
}

/** 多个初始序候选（长度降序是主序，见架构文档 §6.2 stripPacker） */
function heuristicOrders(instances: SearchInstance[]): SearchInstance[][] {
  const byLen = (a: PackItem, b: PackItem) => b.slotLen - a.slotLen || b.slotWid - a.slotWid
  const byArea = (a: PackItem, b: PackItem) => b.slotLen * b.slotWid - a.slotLen * a.slotWid
  const byWid = (a: PackItem, b: PackItem) => b.slotWid - a.slotWid || b.slotLen - a.slotLen
  return [
    [...instances].sort(byLen),
    [...instances].sort(byArea),
    [...instances].sort(byWid),
  ]
}

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** 扰动类型（move 分支自文档化，randInt(rng, 5) 取值 0-4） */
const MOVE = {
  SWAP: 0,
  ROTATE: 1,
  MOVE_ONE: 2,
  ROTATE_GROUP: 3,
  MOVE_GROUP: 4,
} as const

function makeSolver(library: SheetLibraryEntry[], kerf: number) {
  const tryPack = (items: PackItem[]): PackResult | null => {
    const r = packSequence(items, library, kerf)
    return r.sheets.length === 0 ? null : r
  }
  return tryPack
}

export function search(params: SearchParams): SearchOutcome {
  const { instances, library, kerf, minReusableWaste, iterations, seed } = params
  const rng: Rng = mulberry32(seed)
  const tryPack = makeSolver(library, kerf)
  const evalIt = (r: PackResult): EvalScore => evaluatePlan(r, minReusableWaste)

  const n = instances.length

  const checkAbort = () => {
    if (params.signal?.aborted) throw new DOMException('cancelled', 'AbortError')
  }

  // ---- 初始解：启发式序 + 随机序，取字典序最优（此阶段也响应取消 + 报进度）----
  const initial = [...heuristicOrders(instances)]
  for (let k = 0; k < 12; k++) initial.push(shuffle(instances, rng))
  const totalSteps = initial.length + iterations
  let bestItems: SearchInstance[] = []
  let bestResult: PackResult | null = null
  let bestScore: EvalScore | null = null
  for (let k = 0; k < initial.length; k++) {
    checkAbort()
    params.onProgress?.(k / totalSteps)
    const r = tryPack(initial[k])
    if (!r) continue
    const s = evalIt(r)
    if (!bestScore || compareScores(s, bestScore) > 0) {
      bestItems = initial[k]
      bestResult = r
      bestScore = s
    }
  }
  if (!bestResult || !bestScore) {
    // 退化输入（任何序都排不出）——由调用方保证不会发生
    return { result: { sheets: [] }, score: { sheetCount: 0, compactness: 0, reusableWasteBlocks: 0, largestReusableWaste: 0 } }
  }

  // 温度单位为"紧凑度劣化的毫米数"：1000mm → 0.001mm（对应用权重 1e12 时期的 T0=1e15/T1=1e9，
  // 换算后节奏完全一致）。温度永远只放松"同类聚排"层，绝不放松"用板张数"层。
  const T0 = 1e3
  const T1 = 1e-3
  const reportEvery = Math.max(8, Math.floor(iterations / 40))

  /** 一次退火细化：从 startItems 出发跑 limit 次迭代 */
  const anneal = (startItems: SearchInstance[], limit: number, fromIter: number): SearchInstance[] => {
    let curItems: SearchInstance[] = [...startItems]
    let curResult = tryPack(curItems)!
    let curScore = evalIt(curResult)

    for (let it = 0; it < limit; it++) {
      const global = fromIter + it
      checkAbort()
      if (global % reportEvery === 0) {
        params.onProgress?.((initial.length + global) / totalSteps)
      }
      const T = T0 * Math.pow(T1 / T0, global / iterations)

      if (n <= 1) break
      const move = randInt(rng, 5)
      let mutated: SearchInstance[] | null = null
      if (move === MOVE.SWAP) {
        // 交换两个随机位置
        const i = randInt(rng, n)
        let j = randInt(rng, n - 1)
        if (j >= i) j++
        mutated = [...curItems]
        ;[mutated[i], mutated[j]] = [mutated[j], mutated[i]]
      } else if (move === MOVE.ROTATE) {
        // 翻转一个随机实例
        const i = randInt(rng, n)
        const inst = curItems[i]
        if (inst.rotatable) {
          mutated = [...curItems]
          const m = { ...inst }
          m.rotated = !m.rotated
          m.slotLen = m.rotated ? m.baseSlotWid : m.baseSlotLen
          m.slotWid = m.rotated ? m.baseSlotLen : m.baseSlotWid
          m.len = m.rotated ? m.baseWid : m.baseLen
          m.wid = m.rotated ? m.baseLen : m.baseWid
          mutated[i] = m
        }
      } else if (move === MOVE.MOVE_ONE) {
        // 移动一个实例到随机位置
        const i = randInt(rng, n)
        let j = randInt(rng, n - 1)
        if (j >= i) j++
        mutated = [...curItems]
        const [item] = mutated.splice(i, 1)
        mutated.splice(j, 0, item)
      } else if (move === MOVE.ROTATE_GROUP) {
        // 整组旋转：随机零件类型的全部实例一起翻转（协同动作）
        const byId = new Map<string, number[]>()
        curItems.forEach((it, i) => {
          if (it.rotatable) {
            const list = byId.get(it.partId)
            if (list) list.push(i)
            else byId.set(it.partId, [i])
          }
        })
        const groups = [...byId.entries()]
        if (groups.length > 0) {
          const [, idxs] = groups[randInt(rng, groups.length)]
          mutated = [...curItems]
          for (const i of idxs) {
            const m = { ...mutated[i] }
            m.rotated = !m.rotated
            m.slotLen = m.rotated ? m.baseSlotWid : m.baseSlotLen
            m.slotWid = m.rotated ? m.baseSlotLen : m.baseSlotWid
            m.len = m.rotated ? m.baseWid : m.baseLen
            m.wid = m.rotated ? m.baseLen : m.baseWid
            mutated[i] = m
          }
        }
      } else {
        // MOVE.MOVE_GROUP：整组移动——随机零件类型的全部实例挪到随机位置（连续段）
        const byId = new Map<string, number[]>()
        curItems.forEach((it, i) => {
          const list = byId.get(it.partId)
          if (list) list.push(i)
          else byId.set(it.partId, [i])
        })
        const groups = [...byId.entries()] // 每组至少 1 个实例，无需过滤
        if (groups.length > 1) {
          const [, idxs] = groups[randInt(rng, groups.length)]
          const items = idxs.map((i) => curItems[i])
          const rest = curItems.filter((_, i) => !idxs.includes(i))
          if (rest.length > 0) {
            const pos = randInt(rng, rest.length + 1)
            mutated = [...rest.slice(0, pos), ...items, ...rest.slice(pos)]
          }
        }
      }
      if (!mutated) continue

      const candidate = tryPack(mutated)
      if (!candidate) continue
      const candScore = evalIt(candidate)

      // 分层接受（字典序，见 evaluate.ts）：板数层是硬规则——
      // 候选多一张板永不接受；同板数下严格更优直接接受，
      // 更差只允许按"紧凑度严格劣化量（mm）"退火接受（温度永远不放松板数；
      // 紧凑度相同而余料层更差的候选一律拒绝——低层比较保持精确）。
      const cmp = compareScores(candScore, curScore)
      let accept = false
      if (cmp > 0) {
        accept = true
      } else if (cmp < 0 && candScore.sheetCount === curScore.sheetCount) {
        const deltaMm = candScore.compactness - curScore.compactness
        if (deltaMm > EPSILON && rng() < Math.exp(-deltaMm / T)) accept = true
      }
      if (accept) {
        curItems = mutated
        curResult = candidate
        curScore = candScore
        if (compareScores(curScore, bestScore!) > 0) {
          bestScore = curScore
          bestItems = [...curItems]
          bestResult = curResult
        }
      }
    }
    return curItems
  }

  // ---- 主退火 ----
  const mainIters = Math.max(1, Math.floor(iterations * 0.6))
  let current = anneal(bestItems, mainIters, 0)

  // ---- ILS：大扰动踢 + 短退火，重复几次 ----
  const kickCount = 3
  const kickIters = Math.max(1, Math.floor((iterations - mainIters) / kickCount))
  let done = mainIters
  for (let k = 0; k < kickCount; k++) {
    // 踢：随机移动一段连续序列（长度 5%~15%）
    if (n <= 1) break
    const runLen = Math.max(2, Math.floor(n * (0.05 + rng() * 0.1)))
    const start = randInt(rng, n - runLen + 1)
    const run = current.slice(start, start + runLen)
    const rest = [...current.slice(0, start), ...current.slice(start + runLen)]
    const pos = randInt(rng, rest.length + 1)
    const kicked = [...rest.slice(0, pos), ...run, ...rest.slice(pos)]
    current = anneal(kicked, kickIters, done)
    done += kickIters
  }

  checkAbort()
  params.onProgress?.(1)
  return { result: bestResult, score: bestScore }
}
