/**
 * ReviewModal 工具函数单测 —— 识别图片内容哈希（服务端幂等去重契约）。
 */
import { describe, it, expect } from 'vitest'
import { hashImage } from '../src/ui/ReviewModal'

describe('hashImage', () => {
  it('SHA-256 hex：同内容同哈希、64 位十六进制、不同内容不同哈希', async () => {
    const ha = await hashImage(new Blob(['hello']))
    expect(ha).toMatch(/^[0-9a-f]{64}$/)
    expect(ha).toBe(await hashImage(new Blob(['hello'])))
    expect(ha).not.toBe(await hashImage(new Blob(['world'])))
    // 相同内容即使包装不同也一致（幂等去重的判定基础）
    const buf = new Uint8Array([1, 2, 3, 4])
    expect(await hashImage(new Blob([buf]))).toBe(await hashImage(new Blob([buf])))
  })
})
