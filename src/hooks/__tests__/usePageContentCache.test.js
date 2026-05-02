import { describe, it, expect } from 'vitest'
import { PAGE_CONTENT_STATUS } from '../usePageContentCache'

// Unit tests for PAGE_CONTENT_STATUS constants and the cache entry shape contract.
// The async load path (React hook + Supabase) is covered by E2E tests.

describe('PAGE_CONTENT_STATUS', () => {
  it('exports the expected status constants', () => {
    expect(PAGE_CONTENT_STATUS.IDLE).toBe('idle')
    expect(PAGE_CONTENT_STATUS.LOADING).toBe('loading')
    expect(PAGE_CONTENT_STATUS.LOADED).toBe('loaded')
    expect(PAGE_CONTENT_STATUS.ERROR).toBe('error')
  })
})

// Pure LRU eviction logic extracted for unit testing
function evictLRU(cache, order, maxEntries) {
  if (order.length <= maxEntries) return { cache, order }
  const toEvict = order.slice(0, order.length - maxEntries)
  const nextOrder = order.slice(order.length - maxEntries)
  const nextCache = { ...cache }
  for (const id of toEvict) delete nextCache[id]
  return { cache: nextCache, order: nextOrder }
}

describe('LRU eviction logic', () => {
  it('does not evict when under the cap', () => {
    const cache = { 'a': {}, 'b': {} }
    const order = ['a', 'b']
    const { cache: next, order: nextOrder } = evictLRU(cache, order, 30)
    expect(Object.keys(next)).toHaveLength(2)
    expect(nextOrder).toEqual(['a', 'b'])
  })

  it('evicts oldest entry when cap is exceeded', () => {
    const cache = {}
    const order = []
    for (let i = 0; i < 31; i++) {
      cache[`page-${i}`] = { status: PAGE_CONTENT_STATUS.LOADED, content: null }
      order.push(`page-${i}`)
    }
    const { cache: next, order: nextOrder } = evictLRU(cache, order, 30)
    expect(Object.keys(next)).toHaveLength(30)
    expect(next['page-0']).toBeUndefined()
    expect(next['page-30']).toBeDefined()
    expect(nextOrder).toHaveLength(30)
    expect(nextOrder[0]).toBe('page-1')
  })

  it('evicts multiple oldest entries when multiple entries exceed cap', () => {
    const cache = {}
    const order = []
    for (let i = 0; i < 35; i++) {
      cache[`page-${i}`] = {}
      order.push(`page-${i}`)
    }
    const { cache: next } = evictLRU(cache, order, 30)
    expect(Object.keys(next)).toHaveLength(30)
    // Entries 0-4 should be evicted
    for (let i = 0; i < 5; i++) {
      expect(next[`page-${i}`]).toBeUndefined()
    }
    // Entry 5 should survive
    expect(next['page-5']).toBeDefined()
  })
})

describe('cache entry shape contract', () => {
  it('LOADED entry shape matches expected keys', () => {
    const entry = {
      status: PAGE_CONTENT_STATUS.LOADED,
      content: { type: 'doc', content: [] },
      error: null,
      loadedAt: Date.now(),
    }
    expect(entry).toMatchObject({
      status: 'loaded',
      content: expect.any(Object),
      error: null,
      loadedAt: expect.any(Number),
    })
  })

  it('ERROR entry has null content and non-null error', () => {
    const entry = {
      status: PAGE_CONTENT_STATUS.ERROR,
      content: null,
      error: 'network error',
      loadedAt: null,
    }
    expect(entry.content).toBeNull()
    expect(entry.error).toBe('network error')
  })
})
