import { describe, it, expect } from 'vitest'
import { pickPostDeleteTarget } from '../navigationHistoryHelpers'

// A minimal history stub whose getRecentExisting returns the first id in
// `order` that is still present in existingIds and not excluded.
function makeHistory(order) {
  return {
    getRecentExisting(_kind, existingIds, excludeId = null) {
      const existing = new Set(existingIds)
      for (const id of order) {
        if (id === excludeId) continue
        if (existing.has(id)) return id
      }
      return null
    },
  }
}

const items = (...ids) => ids.map((id) => ({ id }))

describe('pickPostDeleteTarget', () => {
  it('returns the most-recent visited survivor when history has one', () => {
    const history = makeHistory(['c', 'b']) // b is most recent surviving
    const target = pickPostDeleteTarget({
      history,
      kind: 'pages',
      remainingItems: items('a', 'b', 'd'),
      deletedId: 'c',
      deletedIndex: 2,
    })
    expect(target).toBe('b')
  })

  it('falls back to the adjacent (next) sibling when history is empty', () => {
    const history = makeHistory([])
    // Original order: a, b(deleted), c, d → remaining a, c, d; deletedIndex 1.
    const target = pickPostDeleteTarget({
      history,
      kind: 'pages',
      remainingItems: items('a', 'c', 'd'),
      deletedId: 'b',
      deletedIndex: 1,
    })
    expect(target).toBe('c') // the item that followed the deleted one
  })

  it('falls back to the previous sibling when the deleted item was last', () => {
    const history = makeHistory([])
    // Original: a, b, c(deleted) → remaining a, b; deletedIndex 2 (no next).
    const target = pickPostDeleteTarget({
      history,
      kind: 'pages',
      remainingItems: items('a', 'b'),
      deletedId: 'c',
      deletedIndex: 2,
    })
    expect(target).toBe('b')
  })

  it('falls back to the first remaining item when no history and no index', () => {
    const target = pickPostDeleteTarget({
      history: makeHistory([]),
      kind: 'sections',
      remainingItems: items('x', 'y'),
      deletedId: 'z',
    })
    expect(target).toBe('x')
  })

  it('returns null when nothing remains', () => {
    const target = pickPostDeleteTarget({
      history: makeHistory(['z']),
      kind: 'notebooks',
      remainingItems: [],
      deletedId: 'z',
      deletedIndex: 0,
    })
    expect(target).toBeNull()
  })

  it('never returns the deleted id', () => {
    // History prefers the deleted id, but it must be excluded.
    const history = makeHistory(['gone', 'keep'])
    const target = pickPostDeleteTarget({
      history,
      kind: 'pages',
      remainingItems: items('keep'),
      deletedId: 'gone',
      deletedIndex: 0,
    })
    expect(target).toBe('keep')
  })

  it('works with a null history (no recorded visits)', () => {
    const target = pickPostDeleteTarget({
      history: null,
      kind: 'pages',
      remainingItems: items('a', 'b', 'c'),
      deletedId: 'd',
      deletedIndex: 1,
    })
    expect(target).toBe('b')
  })
})
