/**
 * 测试字体 fixture 生成 —— 从完整字体子集化出小体积测试字体（提交入库，见 .gitignore 豁免）：
 *   tests/fixtures/fonts/test-cjk.ttf   含 exporter 测试用中文文本 + FORMAT_GLYPHS
 *   tests/fixtures/fonts/test-thai.ttf  含 exporter 测试用泰文文本 + FORMAT_GLYPHS
 * 运行：node scripts/make-test-fonts.mjs（需要已下载完整字体：tests/fixtures/fonts/NotoSansSC-wght.ttf 等）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { subsetFontToTtf } from '../src/infra/fonts/subset.ts'

const OUT_DIR = 'tests/fixtures/fonts'

// 与 exporter.test.ts 完全一致的文本集（labels + partNames + sheetNames + FORMAT_GLYPHS）
const FORMAT_GLYPHS = (() => {
  let s = ''
  for (let c = 0x20; c <= 0x7e; c++) s += String.fromCharCode(c)
  return s + '×·²…—'
})()

const CJK_TEXTS = '客厅柜木工坊工业园区8号138-0000-0000板材数利用率余料面积可再利用块最大块零件总面积封边长度板材库件2026-08-05样品水印侧板抽屉面板颗粒板橡木多层板' + FORMAT_GLYPHS
const THAI_TEXTS = 'ตู้เสื้อผ้าชั้นวาง' + FORMAT_GLYPHS

function load(name) {
  const p = `tests/fixtures/fonts/${name}`
  if (!existsSync(p)) throw new Error(`缺少 ${p}（先运行 npm run fonts:fetch 或手动下载完整字体）`)
  const f = readFileSync(p)
  return f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength)
}

const wasmBuf = readFileSync('node_modules/harfbuzzjs/hb-subset.wasm')
const wasm = wasmBuf.buffer.slice(wasmBuf.byteOffset, wasmBuf.byteOffset + wasmBuf.byteLength)

mkdirSync(OUT_DIR, { recursive: true })

const [cjk, thai] = await Promise.all([
  subsetFontToTtf(load('NotoSansSC-wght.ttf'), CJK_TEXTS, wasm),
  subsetFontToTtf(load('NotoSansThai-wght.ttf'), THAI_TEXTS, wasm),
])

writeFileSync(`${OUT_DIR}/test-cjk.ttf`, new Uint8Array(cjk))
writeFileSync(`${OUT_DIR}/test-thai.ttf`, new Uint8Array(thai))
console.log(`✔ test-cjk.ttf ${(cjk.byteLength / 1024).toFixed(0)} KB`)
console.log(`✔ test-thai.ttf ${(thai.byteLength / 1024).toFixed(0)} KB`)
