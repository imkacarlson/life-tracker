import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  readStoredColor,
  saveStoredColor,
  readStoredScrollPositions,
  saveStoredScrollPositions,
} from '../storage'
import { MAX_SCROLL_POSITIONS, SCROLL_POSITIONS_KEY } from '../constants'

const KEY = 'life-tracker:test-color'

// In-memory localStorage stub so these stay pure node unit tests (no jsdom).
function createLocalStorageStub() {
  const store = new Map()
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  }
}

describe('readStoredColor / saveStoredColor', () => {
  beforeEach(() => {
    globalThis.window = { localStorage: createLocalStorageStub() }
  })

  afterEach(() => {
    delete globalThis.window
  })

  it('round-trips a hex color', () => {
    saveStoredColor(KEY, '#86efac')
    expect(readStoredColor(KEY, '#fef08a')).toBe('#86efac')
  })

  it('round-trips a persisted null ("No Color") as null, not the fallback', () => {
    saveStoredColor(KEY, null)
    expect(readStoredColor(KEY, '#fef08a')).toBeNull()
  })

  it('returns the fallback when the key was never set', () => {
    expect(readStoredColor(KEY, '#fef08a')).toBe('#fef08a')
  })

  it('returns the fallback (null) when never set and fallback is null', () => {
    expect(readStoredColor(KEY, null)).toBeNull()
  })

  it('distinguishes a persisted null from a never-set key', () => {
    expect(readStoredColor(KEY, '#fef08a')).toBe('#fef08a') // never set
    saveStoredColor(KEY, null)
    expect(readStoredColor(KEY, '#fef08a')).toBeNull() // explicitly "No Color"
  })

  it('overwrites a previously stored color', () => {
    saveStoredColor(KEY, '#86efac')
    saveStoredColor(KEY, '#93c5fd')
    expect(readStoredColor(KEY, '#fef08a')).toBe('#93c5fd')
  })

  it('returns the fallback when window is undefined (SSR-safe)', () => {
    delete globalThis.window
    expect(readStoredColor(KEY, '#fef08a')).toBe('#fef08a')
  })
})

describe('readStoredScrollPositions / saveStoredScrollPositions', () => {
  beforeEach(() => {
    globalThis.window = { sessionStorage: createLocalStorageStub() }
  })

  afterEach(() => {
    delete globalThis.window
  })

  it('round-trips a map of page offsets', () => {
    saveStoredScrollPositions({ a: 120, b: 0, c: 999 })
    expect(readStoredScrollPositions()).toEqual({ a: 120, b: 0, c: 999 })
  })

  it('returns an empty object when nothing is stored', () => {
    expect(readStoredScrollPositions()).toEqual({})
  })

  it('guards against malformed JSON', () => {
    globalThis.window.sessionStorage.setItem(SCROLL_POSITIONS_KEY, '{not json')
    expect(readStoredScrollPositions()).toEqual({})
  })

  it('drops non-numeric / non-finite values on read', () => {
    globalThis.window.sessionStorage.setItem(
      SCROLL_POSITIONS_KEY,
      JSON.stringify({ a: 10, b: 'nope', c: null, d: 42 }),
    )
    expect(readStoredScrollPositions()).toEqual({ a: 10, d: 42 })
  })

  it('drops non-numeric values on write', () => {
    saveStoredScrollPositions({ a: 10, b: 'nope', c: 20 })
    expect(readStoredScrollPositions()).toEqual({ a: 10, c: 20 })
  })

  it('caps storage to the most-recent MAX_SCROLL_POSITIONS entries', () => {
    const positions = {}
    for (let i = 0; i < MAX_SCROLL_POSITIONS + 10; i += 1) {
      positions[`page-${i}`] = i
    }
    saveStoredScrollPositions(positions)
    const read = readStoredScrollPositions()
    expect(Object.keys(read)).toHaveLength(MAX_SCROLL_POSITIONS)
    // The oldest (lowest-index) entries are evicted; the newest survive.
    expect(read['page-0']).toBeUndefined()
    expect(read[`page-${MAX_SCROLL_POSITIONS + 9}`]).toBe(MAX_SCROLL_POSITIONS + 9)
  })

  it('returns an empty object when window is undefined (SSR-safe)', () => {
    delete globalThis.window
    expect(readStoredScrollPositions()).toEqual({})
  })
})
