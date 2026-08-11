/**
 * 字体资产获取 —— 发布流程显式运行（npm run fonts:fetch）：
 * 按来源顺序下载 CJK/泰文字体到 public/fonts/（本地优先渠道），
 * 之后导出 PDF 在本地命中，不再依赖外网 CDN。
 * 字体不入 git（见 .gitignore）；CDN 不可达时本脚本也可运行（跳过即可）。
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 目标文件名 → 候选来源（第一个下载成功即用） */
const TARGETS = {
  'fonts/NotoSansSC-Regular.ttf': [
    'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf',
    'https://fastly.jsdelivr.net/gh/google/fonts@main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf',
    'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf',
  ],
  'fonts/NotoSansThai-Regular.ttf': [
    'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosansthai/NotoSansThai%5Bwdth%2Cwght%5D.ttf',
    'https://fastly.jsdelivr.net/gh/google/fonts@main/ofl/notosansthai/NotoSansThai%5Bwdth%2Cwght%5D.ttf',
    'https://raw.githubusercontent.com/google/fonts/main/ofl/notosansthai/NotoSansThai%5Bwdth%2Cwght%5D.ttf',
  ],
}

/** sfnt 魔数校验（与运行时 isValidTtfFont 一致，防错误页入库） */
function isValidTtf(bytes) {
  if (bytes.length < 100) return false
  const b = bytes
  return (
    (b[0] === 0x00 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) ||
    (b[0] === 0x4f && b[1] === 0x54 && b[2] === 0x54 && b[3] === 0x4f)
  )
}

async function fetchBytes(url) {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return new Uint8Array(await resp.arrayBuffer())
}

let okCount = 0
let failCount = 0

for (const [rel, urls] of Object.entries(TARGETS)) {
  const outPath = resolve(ROOT, 'public', rel)
  if (existsSync(outPath)) {
    console.log(`✔ ${rel} 已存在，跳过（删除该文件可重新下载）`)
    okCount++
    continue
  }
  let lastError = null
  for (const url of urls) {
    try {
      const bytes = await fetchBytes(url)
      if (!isValidTtf(bytes)) throw new Error('sfnt 校验失败')
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, bytes)
      console.log(`✔ ${rel} <- ${url}（${(bytes.length / 1024 / 1024).toFixed(1)} MB）`)
      okCount++
      break
    } catch (e) {
      lastError = e
      console.warn(`  ✗ ${url}：${e.message}`)
    }
  }
  if (!existsSync(outPath)) {
    failCount++
    console.error(`✘ ${rel} 全部来源失败（最后错误：${lastError?.message}）`)
  }
}

console.log(`\n完成：${okCount}/${Object.keys(TARGETS).length} 个字体就绪${failCount > 0 ? `，${failCount} 个失败（离线时忽略，运行时走 CDN 兜底）` : ''}`)
process.exit(failCount > 0 ? 1 : 0)
