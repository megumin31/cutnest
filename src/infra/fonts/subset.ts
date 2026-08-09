/**
 * 浏览器/Node 双端可用的字体子集化 —— 直接调用 hb-subset.wasm 裸导出。
 * （subset-font 包是 Node-only：内部 require('fs')，浏览器不可用，故在此复刻其调用序列；
 *  hb-subset.wasm 无导入、无 __wasm_call_ctors，必须裸 instantiate，不能用 emscripten 胶水。）
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
    wasmPromise = WebAssembly.instantiate(wasmBinary).then((r) => r.instance.exports as unknown as HbSubsetWasm)
  }
  return wasmPromise
}

/**
 * 将 TTF 字体按文本子集化为 sfnt(TTF) 字节。
 * @param fontBytes 完整 TTF 字体
 * @param text 需要保留的字符
 * @param wasmBinary hb-subset.wasm 内容
 */
export async function subsetFontToTtf(
  fontBytes: ArrayBuffer,
  text: string,
  wasmBinary: ArrayBuffer,
): Promise<ArrayBuffer> {
  const hb = await getWasm(wasmBinary)

  const input = hb.hb_subset_input_create_or_fail()
  if (input === 0) throw new Error('hb_subset_input_create_or_fail failed')

  const fontPtr = hb.malloc(fontBytes.byteLength)
  const heapu8 = new Uint8Array(hb.memory.buffer)
  heapu8.set(new Uint8Array(fontBytes), fontPtr)

  const blob = hb.hb_blob_create(fontPtr, fontBytes.byteLength, 2, 0, 0)
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

  return out.buffer as ArrayBuffer
}
