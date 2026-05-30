import { describe, expect, it } from 'vitest'

import { isAuthorized } from './auth.ts'

describe('isAuthorized', () => {
  it('allows the configured user in their own private chat', () => {
    expect(isAuthorized(111, 111, 111)).toBe(true)
    // Telegram sends numeric ids; config arrives as a string env var.
    expect(isAuthorized(111, 111, '111')).toBe(true)
  })

  it('rejects a different sender', () => {
    expect(isAuthorized(222, 222, 111)).toBe(false)
  })

  it('rejects when the chat does not match the sender (reply-destination pinning)', () => {
    // Forged: claims to be the allowed user but routes the reply to another chat.
    expect(isAuthorized(111, 999, 111)).toBe(false)
  })

  it('rejects when no allowed id is configured', () => {
    expect(isAuthorized(111, 111, '')).toBe(false)
    expect(isAuthorized(111, 111, null)).toBe(false)
    expect(isAuthorized(111, 111, undefined)).toBe(false)
  })

  it('rejects missing sender/chat', () => {
    expect(isAuthorized(undefined, 111, 111)).toBe(false)
    expect(isAuthorized(111, undefined, 111)).toBe(false)
  })
})
