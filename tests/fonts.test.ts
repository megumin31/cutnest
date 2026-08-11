/**
 * 字体子集化防御性校验单测 ——
 * 修复场景：IndexedDB 读回 Blob → 空数组喂 hb → 12 字节垃圾 TTF →
 * jsPDF addFont 解析失败被吞 → 渲染报 "reading 'widths'"。
 * fixture：tests/fixtures/fonts/test-cjk.ttf（scripts/make-test-fonts.mjs 生成，提交入库）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { subsetFontToTtf, isValidTtfFont } from '../src/infra/fonts/subset'

const FONT = 'tests/fixtures/fonts/test-cjk.ttf'
const WASM = 'node_modules/harfbuzzjs/hb-subset.wasm'

function load(): { font: ArrayBuffer; wasm: ArrayBuffer } {
  const f = readFileSync(FONT)
  const w = readFileSync(WASM)
  return {
    font: f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength),
    wasm: w.buffer.slice(w.byteOffset, w.byteOffset + w.byteLength),
  }
}

describe('isValidTtfFont', () => {
  it('识别合法 TTF 头（0x00010000 / OTTO）', () => {
    expect(isValidTtfFont(new Uint8Array([0x00, 0x01, 0x00, 0x00, ...new Uint8Array(200)]))).toBe(true)
    expect(isValidTtfFont(new Uint8Array([0x4f, 0x54, 0x54, 0x4f, ...new Uint8Array(200)]))).toBe(true)
  })

  it('拒绝垃圾字节 / HTML 错误页 / 过短数据', () => {
    expect(isValidTtfFont(new Uint8Array([1, 2, 3, 4, ...new Uint8Array(200)]))).toBe(false)
    expect(isValidTtfFont(new TextEncoder().encode('<html>404 Not Found</html>'))).toBe(false)
    expect(isValidTtfFont(new Uint8Array([0x00, 0x01, 0x00, 0x00]))).toBe(false) // 头对但太短
    expect(isValidTtfFont(new Uint8Array(0))).toBe(false)
  })

  it('fixture 是合法字体', () => {
    expect(isValidTtfFont(new Uint8Array(load().font))).toBe(true)
  })
})

describe('subsetFontToTtf 防御', () => {
  it('垃圾字节输入：抛明确错误而非产出无效字体', async () => {
    const w = readFileSync(WASM)
    const wasm = w.buffer.slice(w.byteOffset, w.byteOffset + w.byteLength)
    await expect(
      subsetFontToTtf(new Uint8Array([1, 2, 3, 4, 5]).buffer, 'abc', wasm),
    ).rejects.toThrow(/子集化输出无效|hb_subset_or_fail/)
  })

  it('Blob 输入（WebKit 读回行为）：正常子集化', async () => {
    const { font, wasm } = load()
    const asBlob = new Blob([new Uint8Array(font)])
    const out = await subsetFontToTtf(asBlob, '客厅柜木工坊', wasm)
    expect(isValidTtfFont(new Uint8Array(out))).toBe(true)
    expect(out.byteLength).toBeGreaterThan(1000)
  })

  it('ArrayBuffer 输入：正常子集化（回归基线）', async () => {
    const { font, wasm } = load()
    const out = await subsetFontToTtf(font, '客厅柜木工坊', wasm)
    expect(isValidTtfFont(new Uint8Array(out))).toBe(true)
    expect(out.byteLength).toBeGreaterThan(1000)
  })
})
