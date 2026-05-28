import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readStoredColor, saveStoredColor } from '../storage'

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
