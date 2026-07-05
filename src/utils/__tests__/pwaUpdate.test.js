import { describe, it, expect } from 'vitest'
import { shouldCheckForUpdate } from '../pwaUpdate'

describe('shouldCheckForUpdate', () => {
  const base = { hasRegistration: true, installing: false, onLine: true }

  it('runs when registered, idle, and online', () => {
    expect(shouldCheckForUpdate(base)).toBe(true)
  })

  it('skips when there is no registration yet', () => {
    expect(shouldCheckForUpdate({ ...base, hasRegistration: false })).toBe(false)
  })

  it('skips while a new service worker is installing', () => {
    expect(shouldCheckForUpdate({ ...base, installing: true })).toBe(false)
  })

  it('skips when the browser is offline', () => {
    expect(shouldCheckForUpdate({ ...base, onLine: false })).toBe(false)
  })
})
