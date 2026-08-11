/**
 * 导出字体提供器 —— 按文档 §6.3：
 * 拉丁走 jsPDF 内置字体（零下载）；CJK / 泰文独立判定、独立字体（混排时两者都加载），
 * 本地打包优先（public/fonts，npm run fonts:fetch 生成）→ 多 CDN 兜底，
 * IndexedDB 缓存（首次后离线可用），导出时运行时子集化只嵌用到的字符。
 */
import Dexie from 'dexie'
import { needsCjkFont, needsThaiFont } from '../../domain/exporter'
import { subsetFontToTtf, isValidTtfFont } from './subset'
import hbWasmUrl from 'harfbuzzjs/hb-subset.wasm?url'

/** CJK 字体来源：本地打包（构建脚本生成）→ jsdelivr → fastly（国内可达性较好）→ GitHub raw */
export const CJK_FONT_URLS = [
  `${import.meta.env.BASE_URL}fonts/NotoSansSC-Regular.ttf`,
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf',
  'https://fastly.jsdelivr.net/gh/google/fonts@main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf',
  'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf',
]

/** 泰文字体来源（同上结构） */
export const THAI_FONT_URLS = [
  `${import.meta.env.BASE_URL}fonts/NotoSansThai-Regular.ttf`,
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosansthai/NotoSansThai%5Bwdth%2Cwght%5D.ttf',
  'https://fastly.jsdelivr.net/gh/google/fonts@main/ofl/notosansthai/NotoSansThai%5Bwdth%2Cwght%5D.ttf',
  'https://raw.githubusercontent.com/google/fonts/main/ofl/notosansthai/NotoSansThai%5Bwdth%2Cwght%5D.ttf',
]

const CJK_CACHE_KEY = 'cjk-notoscsc-v1'
const THAI_CACHE_KEY = 'thai-notosansthai-v1'

const cacheDb = new Dexie('cut3-assets')
cacheDb.version(1).stores({ fonts: 'key' })

async function fetchWithProgress(url: string, onProgress?: (p: number) => void): Promise<ArrayBuffer> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`字体下载失败：${resp.status}`)
  const total = Number(resp.headers.get('content-length')) || 0
  if (!resp.body || !total || !onProgress) {
    return resp.arrayBuffer()
  }
  const reader = resp.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.byteLength
    onProgress(received / total)
  }
  const out = new Uint8Array(received)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.byteLength
  }
  return out.buffer
}

/** 进行中的下载共享（并发导出不重复下载 17MB 字体） */
const fontInflight = new Map<string, Promise<ArrayBuffer>>()

async function doLoadFontBytes(
  urls: string[],
  cacheKey: string,
  onProgress?: (p: number) => void,
): Promise<ArrayBuffer> {
  // 1. IndexedDB 缓存（WebKit 系读回 ArrayBuffer 可能是 Blob，须规范化；
  //    缓存损坏（非 TTF）时丢弃重下，防垃圾字节进入子集化/PDF 链路）
  const cached = await cacheDb.table('fonts').get(cacheKey)
  if (cached) {
    const data = cached.data instanceof Blob ? await cached.data.arrayBuffer() : (cached.data as ArrayBuffer)
    if (isValidTtfFont(new Uint8Array(data))) return data
    await cacheDb.table('fonts').delete(cacheKey).catch(() => {})
  }
  // 2. 依次尝试本地/CDN（≥100KB 且通过 sfnt 校验才缓存，防错误页/截断数据入库）
  let lastError: unknown = null
  for (const url of urls) {
    try {
      const bytes = await fetchWithProgress(url, onProgress)
      if (isValidTtfFont(new Uint8Array(bytes))) {
        if (bytes.byteLength > 100_000) {
          // 缓存写失败不致命（配额/私有模式）：降级为本次不缓存，字节照常返回
          await cacheDb.table('fonts').put({ key: cacheKey, data: bytes }, cacheKey).catch(() => {})
        }
        return bytes
      }
      throw new Error(`字体数据无效（sfnt 校验失败）：${url}`)
    } catch (e) {
      lastError = e
    }
  }
  throw lastError ?? new Error('无法获取字体')
}

async function loadFontBytes(
  urls: string[],
  cacheKey: string,
  onProgress?: (p: number) => void,
): Promise<ArrayBuffer> {
  const pending = fontInflight.get(cacheKey)
  if (pending) return pending
  const p = doLoadFontBytes(urls, cacheKey, onProgress).finally(() => fontInflight.delete(cacheKey))
  fontInflight.set(cacheKey, p)
  return p
}

export interface ExportFonts {
  /** 需要 CJK 字体时的子集化字体缓冲（TTF） */
  cjk?: ArrayBuffer
  /** 需要泰文字体时的子集化字体缓冲（TTF） */
  thai?: ArrayBuffer
}

/**
 * 为 PDF 导出准备字体：扫描全部文本（词条 + 零件名 + 水印 + 公司名）。
 * CJK 与泰文独立判定、独立下载与子集化（混排时两者都加载；
 * Noto Sans SC 不含泰文字形，泰文必须走 Noto Sans Thai）。
 */
export async function prepareExportFonts(
  texts: string[],
  onProgress?: (p: number) => void,
): Promise<ExportFonts> {
  const needCjk = needsCjkFont(texts)
  const needThai = needsThaiFont(texts)
  if (!needCjk && !needThai) return {}
  const textAll = texts.join('')
  const wasmP = fetch(hbWasmUrl).then((r) => {
    if (!r.ok) throw new Error(`子集化引擎加载失败（HTTP ${r.status}）`)
    return r.arrayBuffer()
  })
  const wasm = await wasmP
  const [cjk, thai] = await Promise.all([
    needCjk ? loadFontBytes(CJK_FONT_URLS, CJK_CACHE_KEY, onProgress).then((f) => subsetFontToTtf(f, textAll, wasm)) : null,
    needThai ? loadFontBytes(THAI_FONT_URLS, THAI_CACHE_KEY, onProgress).then((f) => subsetFontToTtf(f, textAll, wasm)) : null,
  ])
  return {
    ...(cjk ? { cjk } : {}),
    ...(thai ? { thai } : {}),
  }
}
