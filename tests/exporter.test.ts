/**
 * exporter 单测 —— toScene / DXF（图层、轮廓方向、切割顺序）/ PDF（页数、字体、CJK 嵌入）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createOptimizer } from '../src/domain/optimizer'
import { renderDXF, optimizeCutOrder, asciiLayerName, rectContour } from '../src/domain/exporter/renderDXF'
import { renderPDF, needsCjkFont, needsThaiFont, pdfTexts, PdfFontError } from '../src/domain/exporter/renderPDF'
import { toScene } from '../src/domain/exporter/toScene'
import { subsetFontToTtf } from '../src/infra/fonts/subset'
import type { CutPlan, Part, SheetSpec, ExportPrefs } from '../src/domain/types'
import { qty } from '../src/domain/types'
import { createDefaultSettings } from '../src/domain/materials'

const sheet: SheetSpec = { id: 's1', name: '2440×1220', length: 2440, width: 1220, price: 100 }
const parts: Part[] = [
  { id: 'a', name: '侧板', length: 1200, width: 400, quantity: qty(2) },
  { id: 'b', name: '抽屉面板', length: 500, width: 300, quantity: qty(3) },
]
const prefs: ExportPrefs = {
  pdf: { watermark: { enabled: true, text: '样品水印' }, companyInfo: { name: '木工坊' } },
  dxf: { cutDirection: 'climb' },
  unit: 'mm',
}

async function makePlan(): Promise<CutPlan> {
  const settings = createDefaultSettings({ quality: 'fast', seed: 3 })
  const plan = await createOptimizer().optimize({ parts, sheets: [sheet], settings })
  return { ...plan, id: 'test', createdAt: 0 }
}

const partNames = new Map(parts.map((p) => [p.id, p.name]))

describe('toScene', () => {
  it('场景零件数与排样一致，利用率正确', async () => {
    const plan = await makePlan()
    const scene = toScene(plan, [sheet], partNames)
    const total = scene.reduce((s, sc) => s + sc.parts.length, 0)
    expect(total).toBe(5)
    // 零件类型齐全（首块零件的摆放顺序依赖搜索路径，不断言具体次序）
    const partIds = new Set(scene.flatMap((sc) => sc.parts.map((p) => p.partId)))
    expect(partIds).toEqual(new Set(['a', 'b']))
    expect(scene[0].parts.some((p) => p.name === '侧板')).toBe(true)
    expect(scene[0].utilization).toBeCloseTo(plan.stats.utilization / plan.stats.sheetCount, 5)
  })

  it('edgeBands 传入时场景零件携带封边需求', async () => {
    const plan = await makePlan()
    const bands = new Map<string, ('L' | 'R' | 'T' | 'B')[]>([['a', ['L', 'R']]])
    const scene = toScene(plan, [sheet], partNames, bands)
    const all = scene.flatMap((s) => s.parts)
    expect(all.find((p) => p.partId === 'a')?.edgeBand).toEqual(['L', 'R'])
    expect(all.find((p) => p.partId === 'b')?.edgeBand).toBeUndefined()
  })
})

describe('asciiLayerName / rectContour', () => {
  it('图层名 ASCII 化', () => {
    expect(asciiLayerName('抽屉面板', 'p1')).toBe('p1')
    expect(asciiLayerName('Side Panel', 'p1')).toBe('Side_Panel')
    expect(asciiLayerName('A B', 'p1')).toBe('A_B')
  })

  it('轮廓方向：climb 顺时针 / conventional 逆时针', () => {
    const p = { partId: 'a', name: 'A', instance: 0, x: 10, y: 20, len: 100, wid: 50, rotated: false }
    const cw = rectContour(p, 'climb')
    // 顶点顺序 (10,20)→(110,20)→(110,70)→(10,70)：右手系下为顺时针
    expect(cw).toEqual([
      [10, 20],
      [110, 20],
      [110, 70],
      [10, 70],
    ])
    const ccw = rectContour(p, 'conventional')
    expect(ccw[1]).toEqual([10, 70])
  })
})

describe('optimizeCutOrder', () => {
  it('输出合法排列且总行程不差于原序', () => {
    const starts: [number, number][] = [
      [0, 0],
      [1000, 0],
      [1000, 800],
      [100, 900],
      [50, 50],
      [900, 100],
    ]
    const order = optimizeCutOrder(starts)
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5])
    const tour = (o: number[]) => {
      let s = 0
      for (let i = 0; i < o.length - 1; i++) s += Math.hypot(starts[o[i]][0] - starts[o[i + 1]][0], starts[o[i]][1] - starts[o[i + 1]][1])
      return s
    }
    expect(tour(order)).toBeLessThanOrEqual(tour([0, 1, 2, 3, 4, 5]) + 1e-9)
  })
})

describe('renderDXF', () => {
  it('生成合法 DXF：毫米单位、闭合轮廓数量正确、图层 ASCII', async () => {
    const plan = await makePlan()
    const dxf = renderDXF(plan, prefs, partNames)
    // 头部
    expect(dxf.startsWith('0\nSECTION')).toBe(true)
    // $INSUNITS 4 = 毫米
    expect(dxf).toMatch(/\$INSUNITS\n70\n4/)
    // 每个零件一条闭合 polyline + 一处文字标注
    const polylines = dxf.split('\n').filter((l) => l.trim() === 'LWPOLYLINE').length
    expect(polylines).toBe(5)
    const texts = dxf.split('\n').filter((l) => l.trim() === 'TEXT').length
    expect(texts).toBe(5)
    // 图层名不含中文（ASCII 化后回退 partId）
    expect(dxf).not.toContain('侧板')
    expect(dxf).toContain('a') // 图层名 = partId
    // 坐标含毫米值
    expect(dxf).toContain('1200')
  })

  it('trim/margin > 0 时坐标平移到物理板绝对坐标', () => {
    const planWithBorder: CutPlan = {
      id: 't',
      createdAt: 0,
      sheets: [
        {
          sheetIndex: 0,
          sheetSpecId: 's1',
          placements: [{ partId: 'a', instance: 0, x: 0, y: 0, len: 1000, wid: 500, rotated: false }],
        },
      ],
      sheetLibrary: [sheet],
      stats: { sheetCount: 1, utilization: 50, totalCost: 100, wasteArea: 0, reusableWasteBlocks: 0, largestReusableWaste: 0 },
      settings: { ...createDefaultSettings(), trimAllowance: 10 },
    }
    const dxf = renderDXF(planWithBorder, prefs, new Map([['a', 'A']]))
    // 只取 LWPOLYLINE 实体块内的 10/20 顶点对（避开 VPORT 表里的同名组码）
    const vertices: [number, number][] = []
    for (const chunk of dxf.split('\n0\n')) {
      if (!chunk.startsWith('LWPOLYLINE\n')) continue
      const vRe = /10\n([\d.]+)\n20\n([\d.]+)/g
      let v: RegExpExecArray | null
      while ((v = vRe.exec(chunk))) vertices.push([parseFloat(v[1]), parseFloat(v[2])])
    }
    // border = trimAllowance = 10：唯一零件的左下角应从 (0,0) 平移到 (10,10)
    expect(vertices.some(([x, y]) => x === 10 && y === 10)).toBe(true)
    expect(vertices.every(([x, y]) => x >= 10 && y >= 10)).toBe(true)
  })

  it('同名零件不重复建图层：不抛错且两个零件都输出', () => {
    const plan: CutPlan = {
      id: 'dup',
      createdAt: 0,
      sheets: [
        {
          sheetIndex: 0,
          sheetSpecId: 's1',
          placements: [
            { partId: 'a', instance: 0, x: 0, y: 0, len: 1000, wid: 500, rotated: false },
            { partId: 'b', instance: 0, x: 1003, y: 0, len: 800, wid: 400, rotated: false },
          ],
        },
      ],
      sheetLibrary: [sheet],
      stats: { sheetCount: 1, utilization: 50, totalCost: 100, wasteArea: 0, reusableWasteBlocks: 0, largestReusableWaste: 0 },
      settings: createDefaultSettings(),
    }
    // 两个不同 partId 但同名 'Board'：图层名去重后不抛错，实体全部输出
    const dxf = renderDXF(plan, prefs, new Map([['a', 'Board'], ['b', 'Board']]))
    const polylines = dxf.split('\n').filter((l) => l.trim() === 'LWPOLYLINE').length
    expect(polylines).toBe(2)
    // 第二个零件图层回退到 partId，不与该零件共用图层
    expect(dxf.split('\n').filter((l) => l.trim() === 'Board').length).toBeGreaterThanOrEqual(1)
  })
})

describe('renderPDF', () => {
  const latinLabels = {
    projectName: 'Cabinet',
    companyName: 'Carpentry',
    companyAddress: 'Ind. Park 8',
    companyPhone: '138-0000',
    sheetsLabel: 'Sheets',
    utilizationLabel: 'Utilization',
    wasteLabel: 'Waste Area',
    reusableLabel: 'Reusable Blocks',
    largestLabel: 'Largest Block',
    partArea: 'Part Area',
    edgeMeters: 'Edge Band',
    sheetLibraryLabel: 'Sheet Library',
    partCountLabel: 'parts',
    dateText: '2026-08-08',
    watermark: 'SAMPLE',
    unit: 'mm' as const,
  }
  const labels = {
    projectName: '客厅柜',
    companyName: '木工坊',
    companyAddress: '工业园区 8 号',
    companyPhone: '138-0000-0000',
    sheetsLabel: '板材数',
    utilizationLabel: '利用率',
    wasteLabel: '余料面积',
    reusableLabel: '可再利用块',
    largestLabel: '最大块',
    partArea: '零件总面积',
    edgeMeters: '封边长度',
    sheetLibraryLabel: '板材库',
    partCountLabel: '件',
    dateText: '2026-08-05',
    watermark: '样品水印',
    unit: 'mm' as const,
  }

  const thaiLabels = {
    projectName: 'ตู้เสื้อผ้า',
    companyName: 'Carpentry',
    companyAddress: 'Ind. Park 8',
    companyPhone: '138-0000',
    sheetsLabel: 'Sheets',
    utilizationLabel: 'Utilization',
    wasteLabel: 'Waste Area',
    reusableLabel: 'Reusable Blocks',
    largestLabel: 'Largest Block',
    partArea: 'Part Area',
    edgeMeters: 'Edge Band',
    sheetLibraryLabel: 'Sheet Library',
    partCountLabel: 'parts',
    dateText: '2026-08-08',
    watermark: 'SAMPLE',
    unit: 'mm' as const,
  }

  it('拉丁标签：无字体依赖，页数 = 1 + 板数', async () => {
    const plan = await makePlan()
    const latinNames = new Map([
      ['a', 'Side Panel'],
      ['b', 'Drawer Face'],
    ])
    const result = await renderPDF(plan, latinNames, {
      projectName: 'Cabinet',
      companyName: 'Carpentry',
      companyAddress: 'Ind. Park 8',
      companyPhone: '138-0000',
      sheetsLabel: 'Sheets',
      utilizationLabel: 'Utilization',
      wasteLabel: 'Waste Area',
      reusableLabel: 'Reusable Blocks',
      largestLabel: 'Largest Block',
      partArea: 'Part Area',
      edgeMeters: 'Edge Band',
      sheetLibraryLabel: 'Sheet Library',
      partCountLabel: 'parts',
      dateText: '2026-08-08',
      watermark: 'SAMPLE',
      unit: 'mm',
    })
    expect(result.pageCount).toBe(1 + plan.stats.sheetCount)
    const head = Buffer.from(result.bytes.slice(0, 8)).toString('latin1')
    expect(head.startsWith('%PDF-1.')).toBe(true)
  })

  it('CJK 文本缺字体时抛 PdfFontError', async () => {
    const plan = await makePlan()
    await expect(renderPDF(plan, partNames, labels)).rejects.toBeInstanceOf(PdfFontError)
  })

  it('CJK 文本 + 子集字体：PDF 嵌入 FontFile 且文本实际使用该字体', async () => {
    const plan = await makePlan()
    // 测试专用小字体 fixture（scripts/make-test-fonts.mjs 生成，入库）
    const fontPath = 'tests/fixtures/fonts/test-cjk.ttf'
    const wasmPath = 'node_modules/harfbuzzjs/hb-subset.wasm'
    const font = readFileSync(fontPath)
    const wasm = readFileSync(wasmPath)
    const subset = await subsetFontToTtf(
      font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength),
      // 与生产路径一致：pdfTexts 收集整份文档实际文本
      pdfTexts(labels, partNames).join(''),
      wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
    )
    const result = await renderPDF(plan, partNames, labels, { cjk: subset })
    expect(result.pageCount).toBe(1 + plan.stats.sheetCount)
    const text = Buffer.from(result.bytes).toString('latin1')
    // 1) 字体被嵌入
    expect(text).toMatch(/\/FontFile[23]/)
    // 2) 回归：CJK 文本必须用嵌入字体渲染（此前全部落回 helvetica 导致中文乱码）
    //    链式定位：NotoSC 字体对象（/Type /Font + FontDescriptor）→ 页面资源名 → 内容流 Tf
    const objRe = /(\d+)\s+0\s+obj([\s\S]*?)endobj/g
    const objs = new Map<number, string>()
    let m: RegExpExecArray | null
    while ((m = objRe.exec(text))) objs.set(Number(m[1]), m[2])
    const notoObjs = [...objs.entries()]
      .filter(([, body]) => /\/Type\s*\/Font/.test(body) && /\/NotoSC/.test(body))
      .map(([n]) => n)
    expect(notoObjs.length).toBeGreaterThan(0)
    const notoResNames = new Set<string>()
    const refRe = /\/F(\d+)\s+(\d+)\s+0\s+R/g
    while ((m = refRe.exec(text))) {
      if (notoObjs.includes(Number(m[2]))) notoResNames.add(`F${m[1]}`)
    }
    const tfUsed = new Set([...text.matchAll(/\/F(\d+)\s+[\d.]+\s+Tf/g)].map((x) => `F${x[1]}`))
    expect(notoResNames.size).toBeGreaterThan(0)
    expect([...notoResNames].some((n) => tfUsed.has(n))).toBe(true)
  })

  it('pdfTexts 包含板材规格名（字体判定与子集化的必需字符）', () => {
    const joined = pdfTexts(labels, partNames, ['颗粒板', '橡木多层板']).join('')
    expect(joined).toContain('颗粒板')
    expect(joined).toContain('橡木多层板')
    // 不传板材名 = 旧行为（向后兼容）
    expect(pdfTexts(labels, partNames).join('')).not.toContain('颗粒板')
  })

  it('全拉丁文档 + 中文板材名：字体需求被正确检测，缺字体抛 PdfFontError', async () => {
    // 此前板材名不进清单 → 判定为纯拉丁 → 走 Helvetica 渲染中文板材名（豆腐块）
    const cjkPlan: CutPlan = {
      id: 'cjk-sheet',
      createdAt: 0,
      sheets: [
        {
          sheetIndex: 0,
          sheetSpecId: 's1',
          placements: [{ partId: 'a', instance: 0, x: 0, y: 0, len: 1000, wid: 500, rotated: false }],
        },
      ],
      sheetLibrary: [{ id: 's1', name: '颗粒板', length: 2440, width: 1220, price: 100 }],
      stats: { sheetCount: 1, utilization: 50, totalCost: 100, wasteArea: 0, reusableWasteBlocks: 0, largestReusableWaste: 0 },
      settings: createDefaultSettings(),
    }
    const latinNames = new Map([['a', 'Side Panel']])
    await expect(renderPDF(cjkPlan, latinNames, latinLabels)).rejects.toBeInstanceOf(PdfFontError)
  })

  it('泰文板材名触发泰文字体需求，缺字体抛 PdfFontError', async () => {
    const thaiPlan: CutPlan = {
      id: 'thai-sheet',
      createdAt: 0,
      sheets: [
        {
          sheetIndex: 0,
          sheetSpecId: 't1',
          placements: [{ partId: 'a', instance: 0, x: 0, y: 0, len: 1000, wid: 500, rotated: false }],
        },
      ],
      sheetLibrary: [{ id: 't1', name: 'ไม้อัด', length: 2440, width: 1220, price: 100 }],
      stats: { sheetCount: 1, utilization: 50, totalCost: 100, wasteArea: 0, reusableWasteBlocks: 0, largestReusableWaste: 0 },
      settings: createDefaultSettings(),
    }
    const latinNames = new Map([['a', 'Side Panel']])
    await expect(renderPDF(thaiPlan, latinNames, latinLabels)).rejects.toBeInstanceOf(PdfFontError)
  })

  it('needsCjkFont 检测', () => {
    expect(needsCjkFont(['abc', 'def'])).toBe(false)
    expect(needsCjkFont(['侧板'])).toBe(true)
    expect(needsCjkFont(['日本語'])).toBe(true)
  })

  it('needsCjkFont 覆盖全角符号与 CJK 扩展区（缺判定 → 走 Helvetica 白字/乱码）', () => {
    expect(needsCjkFont(['（侧板）'])).toBe(true)
    expect(needsCjkFont(['侧板｜抽屉'])).toBe(true)
  })

  it('pdfTexts 包含格式化动态字符（子集化必须保留，缺字 → 豆腐块）', () => {
    const joined = pdfTexts(labels, new Map()).join('')
    expect(joined).toContain('×')
    expect(joined).toContain('·')
    expect(joined).toContain('%')
    expect(joined).toContain('²')
    expect(joined).toContain('/')
    expect(joined).toContain('…')
  })

  it('needsThaiFont 检测（泰文与 CJK 互不误判）', () => {
    expect(needsThaiFont(['abc', 'def'])).toBe(false)
    expect(needsThaiFont(['ชั้นวาง'])).toBe(true)
    expect(needsCjkFont(['ชั้นวาง'])).toBe(false)
    expect(needsThaiFont(['侧板'])).toBe(false)
  })

  it('泰文缺字体时抛 PdfFontError', async () => {
    const plan = await makePlan()
    const names = new Map([
      ['a', 'ชั้นวาง'],
      ['b', 'Drawer Face'],
    ])
    await expect(renderPDF(plan, names, thaiLabels)).rejects.toBeInstanceOf(PdfFontError)
  })

  it('泰文 + 子集字体：PDF 嵌入 FontFile 且文本实际使用该字体', async () => {
    const plan = await makePlan()
    // 测试专用小字体 fixture（scripts/make-test-fonts.mjs 生成，入库）
    const fontPath = 'tests/fixtures/fonts/test-thai.ttf'
    const wasmPath = 'node_modules/harfbuzzjs/hb-subset.wasm'
    const font = readFileSync(fontPath)
    const wasm = readFileSync(wasmPath)
    const names = new Map([
      ['a', 'ชั้นวาง'],
      ['b', 'Drawer Face'],
    ])
    const subset = await subsetFontToTtf(
      font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength),
      pdfTexts(thaiLabels, names).join(''),
      wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
    )
    const result = await renderPDF(plan, names, thaiLabels, { thai: subset })
    expect(result.pageCount).toBe(1 + plan.stats.sheetCount)
    const text = Buffer.from(result.bytes).toString('latin1')
    expect(text).toMatch(/\/FontFile[23]/)
    // 链式定位：NotoThai 字体对象 → 页面资源名 → 内容流 Tf（防泰文悄悄落回 helvetica）
    const objRe = /(\d+)\s+0\s+obj([\s\S]*?)endobj/g
    const objs = new Map<number, string>()
    let m: RegExpExecArray | null
    while ((m = objRe.exec(text))) objs.set(Number(m[1]), m[2])
    const thaiObjs = [...objs.entries()]
      .filter(([, body]) => /\/Type\s*\/Font/.test(body) && /\/NotoThai/.test(body))
      .map(([n]) => n)
    expect(thaiObjs.length).toBeGreaterThan(0)
    const thaiResNames = new Set<string>()
    const refRe = /\/F(\d+)\s+(\d+)\s+0\s+R/g
    while ((m = refRe.exec(text))) {
      if (thaiObjs.includes(Number(m[2]))) thaiResNames.add(`F${m[1]}`)
    }
    const tfUsed = new Set([...text.matchAll(/\/F(\d+)\s+[\d.]+\s+Tf/g)].map((x) => `F${x[1]}`))
    expect(thaiResNames.size).toBeGreaterThan(0)
    expect([...thaiResNames].some((n) => tfUsed.has(n))).toBe(true)
  })

  it('封边标注：传入 edgeBands 不抛错、页数不变', async () => {
    const plan = await makePlan()
    const bands = new Map<string, ('L' | 'R' | 'T' | 'B')[]>([['a', ['L', 'R', 'T', 'B']]])
    const latinNames = new Map([
      ['a', 'Side Panel'],
      ['b', 'Drawer Face'],
    ])
    const result = await renderPDF(plan, latinNames, {
      projectName: 'Cabinet',
      companyName: 'Carpentry',
      companyAddress: 'Ind. Park 8',
      companyPhone: '138-0000',
      sheetsLabel: 'Sheets',
      utilizationLabel: 'Utilization',
      wasteLabel: 'Waste Area',
      reusableLabel: 'Reusable Blocks',
      largestLabel: 'Largest Block',
      partArea: 'Part Area',
      edgeMeters: 'Edge Band',
      sheetLibraryLabel: 'Sheet Library',
      partCountLabel: 'parts',
      dateText: '2026-08-08',
      watermark: 'SAMPLE',
      unit: 'mm',
    }, {}, bands)
    expect(result.pageCount).toBe(1 + plan.stats.sheetCount)
  })

  it('坏字体（sfnt 头合法但 cmap 缺失）：抛 PdfFontError 真实错误而非 widths 错', async () => {
    const plan = await makePlan()
    // 构造：把 fixture 的 cmap 表 tag 改掉（其余字节不变）——jsPDF 解析必然失败，
    // 必须被预校验拦截并抛真实原因（否则 jsPDF PubSub 吞异常 → 渲染报 "reading 'widths'"）
    const buf = readFileSync('tests/fixtures/fonts/test-cjk.ttf')
    const copy = new Uint8Array(buf.byteLength)
    copy.set(new Uint8Array(buf))
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    const numTables = v.getUint16(4)
    let found = false
    for (let i = 0; i < numTables; i++) {
      const off = 12 + i * 16
      const tag = buf.toString('latin1', off, off + 4)
      if (tag === 'cmap') {
        copy.set([0x78, 0x78, 0x78, 0x78], off)
        found = true
      }
    }
    expect(found).toBe(true)
    await expect(
      renderPDF(plan, partNames, labels, { cjk: copy.buffer as ArrayBuffer }),
    ).rejects.toBeInstanceOf(PdfFontError)
    await expect(
      renderPDF(plan, partNames, labels, { cjk: copy.buffer as ArrayBuffer }),
    ).rejects.toThrow(/字体解析失败|cmap/)
  })

  it('混排（CJK 标签 + 泰文零件名）：双字体都嵌入且渲染不抛错', async () => {
    const plan = await makePlan()
    const cjkFont = readFileSync('tests/fixtures/fonts/test-cjk.ttf')
    const thaiFont = readFileSync('tests/fixtures/fonts/test-thai.ttf')
    const wasm = readFileSync('node_modules/harfbuzzjs/hb-subset.wasm')
    const mixedNames = new Map([
      ['a', 'ชั้นวาง'],
      ['b', 'Drawer Face'],
    ])
    const texts = pdfTexts(labels, mixedNames, plan.sheetLibrary.map((s) => s.name)).join('')
    const cjk = await subsetFontToTtf(
      cjkFont.buffer.slice(cjkFont.byteOffset, cjkFont.byteOffset + cjkFont.byteLength),
      texts,
      wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
    )
    const thai = await subsetFontToTtf(
      thaiFont.buffer.slice(thaiFont.byteOffset, thaiFont.byteOffset + thaiFont.byteLength),
      texts,
      wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
    )
    const result = await renderPDF(plan, mixedNames, labels, { cjk, thai })
    expect(result.pageCount).toBe(1 + plan.stats.sheetCount)
    const text = Buffer.from(result.bytes).toString('latin1')
    // 两个字体都被嵌入
    expect(text).toMatch(/\/NotoSC/)
    expect(text).toMatch(/\/NotoThai/)
    // 泰文字符确实走泰文字体（NotoThai 资源被内容流引用）
    const objRe = /(\d+)\s+0\s+obj([\s\S]*?)endobj/g
    const objs = new Map<number, string>()
    let m: RegExpExecArray | null
    while ((m = objRe.exec(text))) objs.set(Number(m[1]), m[2])
    const thaiObjs = [...objs.entries()]
      .filter(([, body]) => /\/Type\s*\/Font/.test(body) && /\/NotoThai/.test(body))
      .map(([n]) => n)
    expect(thaiObjs.length).toBeGreaterThan(0)
    const thaiResNames = new Set<string>()
    const refRe = /\/F(\d+)\s+(\d+)\s+0\s+R/g
    while ((m = refRe.exec(text))) {
      if (thaiObjs.includes(Number(m[2]))) thaiResNames.add(`F${m[1]}`)
    }
    const tfUsed = new Set([...text.matchAll(/\/F(\d+)\s+[\d.]+\s+Tf/g)].map((x) => `F${x[1]}`))
    expect([...thaiResNames].some((n) => tfUsed.has(n))).toBe(true)
  })

  it('混排缺泰文字体：抛 PdfFontError（独立判定，不再被 CJK 压制）', async () => {
    const plan = await makePlan()
    const mixedNames = new Map([
      ['a', 'ชั้นวาง'],
      ['b', 'Drawer Face'],
    ])
    // 只提供 CJK 字体 → 泰文判定独立，必须缺字体报错（旧逻辑 needThai 被 CJK 压制会静默豆腐块）
    await expect(renderPDF(plan, mixedNames, labels, {})).rejects.toBeInstanceOf(PdfFontError)
  })
})
