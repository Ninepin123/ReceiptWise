import { afterEach, describe, expect, it, vi } from 'vitest'
import { uuid } from './uuid.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('uuid', () => {
  afterEach(() => vi.restoreAllMocks())

  it('有 crypto.randomUUID 時直接使用', () => {
    expect(uuid()).toMatch(UUID_V4)
  })

  it('沒有 crypto.randomUUID（非安全環境）時用 getRandomValues 組出 v4', () => {
    vi.spyOn(crypto, 'randomUUID', 'get').mockReturnValue(undefined)
    const ids = new Set(Array.from({ length: 50 }, () => uuid()))
    expect(ids.size).toBe(50)
    for (const id of ids) expect(id).toMatch(UUID_V4)
  })
})
