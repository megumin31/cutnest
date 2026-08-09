/**
 * 导出字体提供器 —— 按文档 §6.3：
 * 拉丁走 jsPDF 内置字体（零下载）；CJK 按需下载（本地资源优先，CDN 兜底），
 * IndexedDB 缓存（首次后离线可用），导出时运行时子集化只嵌用到的字符。
 */
import Dexie from 'dexie'
import { needsCjkFont } from '../../domain/exporter'
import { subsetFontToTtf } from './subset'
import hbWasmUrl from 'harfbuzzjs/hb-subset.wasm?url'

/** 本地打包字体（public/fonts），与 CDN 兜底 */
export const CJK_FONT_URLS = [
  `${import.meta.env.BASE_URL}fonts/NotoSansSC-Regular.ttf`,
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf',
]

const CACHE_KEY = 'cjk-notoscsc-v1'

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

async function loadCjkFontBytes(onProgress?: (p: number) => void): Promise<ArrayBuffer> {
  // 1. IndexedDB 缓存
  const cached = await cacheDb.table('fonts').get(CACHE_KEY)
  if (cached) return cached.data as ArrayBuffer
  // 2. 依次尝试本地/CDN
  let lastError: unknown = null
  for (const url of CJK_FONT_URLS) {
    try {
      const bytes = await fetchWithProgress(url, onProgress)
      if (bytes.byteLength > 1_000_000) {
        await cacheDb.table('fonts').put({ key: CACHE_KEY, data: bytes }, CACHE_KEY)
      }
      return bytes
    } catch (e) {
      lastError = e
    }
  }
  throw lastError ?? new Error('无法获取中文字体')
}

export interface ExportFonts {
  /** 需要 CJK 字体时的子集化字体缓冲（TTF） */
  cjk?: ArrayBuffer
}

/**
 * 为 PDF 导出准备字体：扫描全部文本（词条 + 零件名 + 水印 + 公司名）。
 * 拉丁文本无需任何下载；CJK 文本下载并子集化。
 */
export async function prepareExportFonts(
  texts: string[],
  onProgress?: (p: number) => void,
): Promise<ExportFonts> {
  if (!needsCjkFont(texts)) return {}
  const [full, wasm] = await Promise.all([
    loadCjkFontBytes(onProgress),
    fetch(hbWasmUrl).then((r) => r.arrayBuffer()),
  ])
  const cjk = await subsetFontToTtf(full, texts.join(''), wasm)
  return { cjk }
}
