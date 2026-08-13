/**
 * partCsv 单测 —— 零件表导出/导入（序列化往返、转义、文本格式兼容、坏行跳过）。
 */
import { describe, it, expect } from 'vitest'
import { serializePartsCsv, parsePartsCsv, decodeCsvText } from '../src/features/projects/partCsv'
import type { Part } from '../src/domain/types'
import { qty } from '../src/domain/types'

const sheetName = new Map<string, string>([
  ['s1', '颗粒板'],
  ['s2', '1200×600'],
])

describe('serializePartsCsv', () => {
  it('导出含表头与全部字段，可往返解析', () => {
    const parts: Part[] = [
      { id: 'a', name: '侧板', length: 2440, width: 400, quantity: qty(4), grain: 'alongLength', sheetId: 's1', edgeBand: ['L', 'R'] },
      { id: 'b', name: '层板', length: 800, width: 400, quantity: qty(6) },
    ]
    const csv = serializePartsCsv(parts, (id) => sheetName.get(id))
    expect(csv.charCodeAt(0)).toBe(0xfeff) // UTF-8 BOM（Excel 兼容）
    expect(csv.slice(1).split('\n')[0]).toBe('名称,长度,宽度,数量,旋转,板材,封边')
    const rows = parsePartsCsv(csv, (name) => [...sheetName.entries()].find(([, n]) => n === name)?.[0])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      name: '侧板',
      length: 2440,
      width: 400,
      quantity: qty(4),
      grain: 'alongLength',
      sheetId: 's1',
      edgeBand: ['L', 'R'],
    })
    expect(rows[1]).toMatchObject({ name: '层板', sheetId: undefined })
  })

  it('名称含逗号/引号时正确转义', () => {
    const parts: Part[] = [{ id: 'a', name: '侧板,带"槽"', length: 100, width: 50, quantity: qty(1) }]
    const csv = serializePartsCsv(parts, () => undefined)
    const rows = parsePartsCsv(csv, () => undefined)
    expect(rows[0].name).toBe('侧板,带"槽"')
  })

  it('导出带 UTF-8 BOM（Excel 兼容）且解析自动跳过', () => {
    const parts: Part[] = [{ id: 'a', name: '侧板', length: 100, width: 50, quantity: qty(1) }]
    const csv = serializePartsCsv(parts, () => undefined)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const rows = parsePartsCsv(csv, () => undefined)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('侧板')
  })
})

describe('decodeCsvText', () => {
  it('UTF-8 正常解码', () => {
    const buf = new TextEncoder().encode('侧板,2440,400,4\n').buffer
    expect(decodeCsvText(buf)).toBe('侧板,2440,400,4\n')
  })

  it('UTF-16 LE BOM 文件按 UTF-16 解码', () => {
    // 'A,长\n' 的 UTF-16LE 字节
    const s = 'A,长\n'
    const u16 = new Uint8Array(s.length * 2)
    for (let i = 0; i < s.length; i++) {
      u16[i * 2] = s.charCodeAt(i) & 0xff
      u16[i * 2 + 1] = s.charCodeAt(i) >> 8
    }
    const buf = new Uint8Array([0xff, 0xfe, ...u16]).buffer
    expect(decodeCsvText(buf)).toBe(s)
  })

  it('GBK/ANSI 编码（中文被误读为替换符）时 GBK 兜底解码', () => {
    // '侧板' 的 GBK 字节：UTF-8 下是非法序列 → 产生 U+FFFD → 触发 GBK 重试
    const buf = new Uint8Array([0xb2, 0xe0, 0xb0, 0xe5]).buffer
    expect(decodeCsvText(buf)).toBe('侧板')
  })
})

describe('parsePartsCsv', () => {
  it('兼容批量粘贴文本格式（名称 长 宽 数量）', () => {
    const rows = parsePartsCsv('侧板 2440 400 4\n层板 800 400\n', () => undefined)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ name: '侧板', length: 2440, width: 400, quantity: qty(4) })
    expect(rows[1].quantity).toBe(1)
  })

  it('跳过表头、空行与非法行', () => {
    const rows = parsePartsCsv(
      '名称,长,宽,数量,旋转,板材,封边\n\n侧板 2440 400\n坏行这里没有数字\n层板 800 400 6\n',
      () => undefined,
    )
    expect(rows).toHaveLength(2)
  })

  it('旋转/板材/封边列解析', () => {
    const csv = '名称,长,宽,数量,旋转,板材,封边\n可转件,500,300,2,可旋转,颗粒板,LR\n禁转件,400,200,1,不可旋转,任意,\n'
    const rows = parsePartsCsv(csv, (name) => [...sheetName.entries()].find(([, n]) => n === name)?.[0])
    expect(rows[0].grain).toBe('any')
    expect(rows[0].sheetId).toBe('s1')
    expect(rows[0].edgeBand).toEqual(['L', 'R'])
    expect(rows[1].grain).toBe('alongLength')
    expect(rows[1].sheetId).toBeUndefined()
    expect(rows[1].edgeBand).toBeUndefined()
  })

  it('板材名称不在库中 → 任意（不指定）', () => {
    const csv = '名称,长,宽,数量,旋转,板材,封边\nX,500,300,1,不可旋转,不存在的板,\n'
    const rows = parsePartsCsv(csv, () => undefined)
    expect(rows[0].sheetId).toBeUndefined()
  })

  it('零件名恰为 name/Name/名称 的数据行不被误跳（表头判定仅限首行）', () => {
    const csv = '名称,长度,宽度,数量\nname,100,50,2\nName,200,100,1\n名称,300,150,1\n侧板,400,200,3\n'
    const rows = parsePartsCsv(csv, () => undefined)
    expect(rows.map((r) => r.name)).toEqual(['name', 'Name', '名称', '侧板'])
    expect(rows.map((r) => r.length)).toEqual([100, 200, 300, 400])
  })

  it('批量粘贴首行零件名恰为 name 也不被误跳', () => {
    const rows = parsePartsCsv('name 100 50\n侧板 400 200 3', () => undefined)
    expect(rows.map((r) => r.name)).toEqual(['name', '侧板'])
  })

  it('小数数量截断（与工作区 qty 同语义：2.9→2、0.4→0、0→0）', () => {
    const rows = parsePartsCsv('A,100,50,2.9\nB,100,50,0.4\nC,100,50,0\n', () => undefined)
    expect(rows.map((r) => r.quantity)).toEqual([qty(2), qty(0), qty(0)])
  })

  it('文本格式小数数量同样截断（批量粘贴入口共用同一语义）', () => {
    const rows = parsePartsCsv('A 100 50 2.9\nB 100 50 0.4\nC 100 50 0\n', () => undefined)
    expect(rows.map((r) => r.quantity)).toEqual([qty(2), qty(0), qty(0)])
  })
})
