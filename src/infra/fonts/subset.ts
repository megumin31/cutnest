/**
 * 浏览器/Node 双端可用的字体子集化 —— 直接调用 hb-subset.wasm 裸导出。
 * （subset-font 包是 Node-only：内部 require('fs')，浏览器不可用，故在此复刻其调用序列；
 *  hb-subset.wasm 无导入、无 __wasm_call_ctors，必须裸 instantiate，不能用 emscripten 胶水。）
 *
 * 防御性校验：
 * - 输入规范化：IndexedDB 在部分 WebKit 实现里会把 ArrayBuffer 读回成 Blob，
 *   直接 new Uint8Array(blob) 得到空数组 → hb-subset 输出 12 字节垃圾字体 →
 *   jsPDF addFont 解析失败（异常被其 PubSub 吞掉）→ 渲染报"reading 'widths'"。
 * - 输出校验：sfnt 头 + 最小大小，防垃圾字节进入 PDF 链路。
 */
export interface HbSubsetWasm {
  memory: WebAssembly.Memory
  malloc: (size: number) => number
  free: (ptr: number) => void
  hb_blob_create: (data: number, len: number, mode: number, userData: number, destroy: number) => number
  hb_blob_destroy: (blob: number) => void
  hb_face_create: (blob: number, index: number) => number
  hb_face_destroy: (face: number) => void
  hb_face_reference_blob: (face: number) => number
  hb_blob_get_data: (blob: number, length: number) => number
  hb_blob_get_length: (blob: number) => number
  hb_subset_input_create_or_fail: () => number
  hb_subset_input_destroy: (input: number) => void
  hb_subset_input_set: (input: number, set: number) => number
  hb_subset_input_unicode_set: (input: number) => number
  hb_subset_or_fail: (face: number, input: number) => number
  hb_set_clear: (set: number) => void
  hb_set_invert: (set: number) => void
  hb_set_add: (set: number, codepoint: number) => void
}

let wasmPromise: Promise<HbSubsetWasm> | null = null

async function getWasm(wasmBinary: ArrayBuffer): Promise<HbSubsetWasm> {
  if (!wasmPromise) {
    wasmPromise = WebAssembly.instantiate(wasmBinary)
      .then((r) => r.instance.exports as unknown as HbSubsetWasm)
      .catch((e) => {
        // 失败态不缓存：重置后下次调用可重试（否则一次失败永久废掉导出）
        wasmPromise = null
        throw e
      })
  }
  return wasmPromise
}

/** sfnt/TTF 魔数：\x00\x01\x00\x00（TrueType）、OTTO（CFF）、true/typ1（Mac） */
export function isValidTtfFont(bytes: Uint8Array): boolean {
  if (bytes.length < 100) return false
  const b = bytes
  if (b[0] === 0x00 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return true
  if (b[0] === 0x4f && b[1] === 0x54 && b[2] === 0x54 && b[3] === 0x4f) return true // 'OTTO'
  if (b[0] === 0x74 && b[1] === 0x72 && b[2] === 0x75 && b[3] === 0x65) return true // 'true'
  if (b[0] === 0x74 && b[1] === 0x79 && b[2] === 0x70 && b[3] === 0x31) return true // 'typ1'
  return false
}

/**
 * 将 TTF 字体按文本子集化为 sfnt(TTF) 字节。
 * @param fontBytes 完整 TTF 字体
 * @param text 需要保留的字符
 * @param wasmBinary hb-subset.wasm 内容
 */
export async function subsetFontToTtf(
  fontBytes: ArrayBuffer | Blob,
  text: string,
  wasmBinary: ArrayBuffer,
): Promise<ArrayBuffer> {
  // WebKit 系 IndexedDB 会把 ArrayBuffer 读回成 Blob：规范化后再取字节，避免空数组喂给 hb
  const source = fontBytes instanceof Blob ? await fontBytes.arrayBuffer() : fontBytes
  const hb = await getWasm(wasmBinary)

  const input = hb.hb_subset_input_create_or_fail()
  if (input === 0) throw new Error('hb_subset_input_create_or_fail failed')

  const fontPtr = hb.malloc(source.byteLength)
  const heapView = new Uint8Array(hb.memory.buffer)
  heapView.set(new Uint8Array(source), fontPtr)

  const blob = hb.hb_blob_create(fontPtr, source.byteLength, 2, 0, 0)
  const face = hb.hb_face_create(blob, 0)
  hb.hb_blob_destroy(blob)

  // --font-features=*
  const layoutFeatures = hb.hb_subset_input_set(input, 6 /* HB_SUBSET_SETS_LAYOUT_FEATURE_TAG */)
  hb.hb_set_clear(layoutFeatures)
  hb.hb_set_invert(layoutFeatures)

  const unicodeSet = hb.hb_subset_input_unicode_set(input)
  for (const ch of text) {
    hb.hb_set_add(unicodeSet, ch.codePointAt(0) ?? 0)
  }

  let subset: number
  try {
    subset = hb.hb_subset_or_fail(face, input)
    if (subset === 0) throw new Error('hb_subset_or_fail failed')
  } finally {
    hb.hb_subset_input_destroy(input)
  }

  const resultBlob = hb.hb_face_reference_blob(subset)
  const offset = hb.hb_blob_get_data(resultBlob, 0)
  const length = hb.hb_blob_get_length(resultBlob)
  if (length === 0) throw new Error('subset produced empty font')

  const freshHeap = new Uint8Array(hb.memory.buffer)
  const out = freshHeap.slice(offset, offset + length).slice()
  hb.hb_blob_destroy(resultBlob)
  hb.hb_face_destroy(subset)
  hb.hb_face_destroy(face)
  hb.free(fontPtr)

  // 输出校验：垃圾输入/坏字体可能产出无效字节，必须在这里拦截
  // （否则 jsPDF addFont 解析失败且其 PubSub 吞掉异常 → 渲染报 "reading 'widths'"）
  if (!isValidTtfFont(new Uint8Array(out))) {
    throw new Error('字体子集化输出无效（输入不是合法 TTF 字体，或已损坏）')
  }

  return out.buffer as ArrayBuffer
}
