import { describe, it, expect } from 'vitest'
import {
  canReorder,
  reorderById,
  reindexSortOrder,
  insertPageAfter,
} from '../sidebarReorder'

describe('canReorder', () => {
  it('returns true for same type and same parentId', () => {
    expect(
      canReorder({ type: 'page', parentId: 'sec1' }, { type: 'page', parentId: 'sec1' }),
    ).toBe(true)
  })

  it('returns true for two notebooks (both null parentId)', () => {
    expect(
      canReorder({ type: 'notebook', parentId: null }, { type: 'notebook', parentId: null }),
    ).toBe(true)
  })

  it('returns false for different type', () => {
    expect(
      canReorder({ type: 'notebook', parentId: null }, { type: 'section', parentId: null }),
    ).toBe(false)
  })

  it('returns false for same type but different parentId', () => {
    expect(
      canReorder({ type: 'page', parentId: 'sec1' }, { type: 'page', parentId: 'sec2' }),
    ).toBe(false)
  })

  it('returns false when a null parentId is compared with a real id', () => {
    expect(
      canReorder({ type: 'section', parentId: null }, { type: 'section', parentId: 'nb1' }),
    ).toBe(false)
  })

  it('returns false when either payload is missing', () => {
    expect(canReorder(null, { type: 'page', parentId: 'sec1' })).toBe(false)
    expect(canReorder({ type: 'page', parentId: 'sec1' }, undefined)).toBe(false)
    expect(canReorder(null, null)).toBe(false)
  })

  it('returns false when type is missing', () => {
    expect(canReorder({ parentId: 'sec1' }, { parentId: 'sec1' })).toBe(false)
  })
})

describe('reorderById', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

  it('moves an item down (a after c)', () => {
    const next = reorderById(items, 'a', 'c')
    expect(next.map((i) => i.id)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('moves an item up (d before b)', () => {
    const next = reorderById(items, 'd', 'b')
    expect(next.map((i) => i.id)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('returns a new array (does not mutate input)', () => {
    const next = reorderById(items, 'a', 'b')
    expect(next).not.toBe(items)
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('returns the original array when activeId is missing', () => {
    const next = reorderById(items, 'zzz', 'b')
    expect(next).toBe(items)
  })

  it('returns the original array when overId is missing', () => {
    const next = reorderById(items, 'a', 'zzz')
    expect(next).toBe(items)
  })

  it('returns the original array when active and over are the same', () => {
    const next = reorderById(items, 'b', 'b')
    expect(next).toBe(items)
  })

  it('returns the input unchanged when items is not an array', () => {
    expect(reorderById(null, 'a', 'b')).toBe(null)
  })
})

describe('reindexSortOrder', () => {
  it('assigns sort_order = index + 1', () => {
    const result = reindexSortOrder([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    expect(result).toEqual([
      { id: 'a', sort_order: 1 },
      { id: 'b', sort_order: 2 },
      { id: 'c', sort_order: 3 },
    ])
  })

  it('overwrites existing sort_order values', () => {
    const result = reindexSortOrder([
      { id: 'a', sort_order: 99 },
      { id: 'b', sort_order: 5 },
    ])
    expect(result.map((i) => i.sort_order)).toEqual([1, 2])
  })

  it('returns a new array without mutating the input', () => {
    const input = [{ id: 'a', sort_order: 7 }]
    const result = reindexSortOrder(input)
    expect(result).not.toBe(input)
    expect(input[0].sort_order).toBe(7)
  })

  it('returns the input unchanged when items is not an array', () => {
    expect(reindexSortOrder(undefined)).toBe(undefined)
  })
})

describe('insertPageAfter', () => {
  const pages = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const created = { id: 'new' }

  it('inserts immediately after the active page', () => {
    const next = insertPageAfter(pages, created, 'b')
    expect(next.map((p) => p.id)).toEqual(['a', 'b', 'new', 'c'])
  })

  it('appends when the active page is last', () => {
    const next = insertPageAfter(pages, created, 'c')
    expect(next.map((p) => p.id)).toEqual(['a', 'b', 'c', 'new'])
  })

  it('appends when activeId is null', () => {
    const next = insertPageAfter(pages, created, null)
    expect(next.map((p) => p.id)).toEqual(['a', 'b', 'c', 'new'])
  })

  it('appends when activeId is undefined', () => {
    const next = insertPageAfter(pages, created, undefined)
    expect(next.map((p) => p.id)).toEqual(['a', 'b', 'c', 'new'])
  })

  it('appends when activeId is not found in pages', () => {
    const next = insertPageAfter(pages, created, 'missing')
    expect(next.map((p) => p.id)).toEqual(['a', 'b', 'c', 'new'])
  })

  it('handles a single-page section (insert after the only page)', () => {
    const next = insertPageAfter([{ id: 'a' }], created, 'a')
    expect(next.map((p) => p.id)).toEqual(['a', 'new'])
  })

  it('handles an empty section (created becomes the only page)', () => {
    expect(insertPageAfter([], created, null).map((p) => p.id)).toEqual(['new'])
    expect(insertPageAfter([], created, 'a').map((p) => p.id)).toEqual(['new'])
  })

  it('treats a non-array pages argument as empty', () => {
    expect(insertPageAfter(undefined, created, 'a').map((p) => p.id)).toEqual(['new'])
  })

  it('does not mutate the input array', () => {
    const input = [{ id: 'a' }, { id: 'b' }]
    const next = insertPageAfter(input, created, 'a')
    expect(next).not.toBe(input)
    expect(input.map((p) => p.id)).toEqual(['a', 'b'])
  })
})
