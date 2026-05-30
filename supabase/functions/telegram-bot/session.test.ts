import { describe, expect, it } from 'vitest'

import { shouldReuseSession } from './session.ts'

const now = new Date('2026-05-30T12:00:00Z')

describe('shouldReuseSession', () => {
  it('reuses when within the idle window', () => {
    const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString()
    expect(shouldReuseSession(tenMinAgo, now, 30)).toBe(true)
  })

  it('starts fresh when past the idle window', () => {
    const fortyMinAgo = new Date(now.getTime() - 40 * 60 * 1000).toISOString()
    expect(shouldReuseSession(fortyMinAgo, now, 30)).toBe(false)
  })

  it('treats exactly the window edge as reusable', () => {
    const exactly30 = new Date(now.getTime() - 30 * 60 * 1000).toISOString()
    expect(shouldReuseSession(exactly30, now, 30)).toBe(true)
  })

  it('handles Date and epoch inputs', () => {
    expect(shouldReuseSession(new Date(now.getTime() - 60 * 1000), now, 30)).toBe(true)
    expect(shouldReuseSession(now.getTime() - 60 * 1000, now, 30)).toBe(true)
  })

  it('returns false for missing or invalid timestamps', () => {
    expect(shouldReuseSession(null, now, 30)).toBe(false)
    expect(shouldReuseSession(undefined, now, 30)).toBe(false)
    expect(shouldReuseSession('not a date', now, 30)).toBe(false)
  })
})
