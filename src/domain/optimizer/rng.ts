/**
 * 确定性随机数 —— mulberry32。
 * 所有随机性（模拟退火扰动）必须来自这里，禁止 Math.random（架构文档 §4 规则 7）。
 */
export type Rng = () => number

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** [0, n) 整数 */
export function randInt(rng: Rng, n: number): number {
  return Math.floor(rng() * n)
}
