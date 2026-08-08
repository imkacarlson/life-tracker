import { describe, it, expect } from 'vitest'
import { shouldCheckForUpdate, resolveRefreshAction, isUpdateBannerStale } from '../pwaUpdate'

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

describe('resolveRefreshAction', () => {
  it('messages the waiting worker when one is waiting', () => {
    expect(resolveRefreshAction({ hasWaiting: true })).toBe('skip-waiting')
  })

  it('falls back to a plain reload when nothing is waiting', () => {
    // The dead-button case: the worker already activated, so skipWaiting would
    // be a silent no-op — reloading is what actually lands the new build.
    expect(resolveRefreshAction({ hasWaiting: false })).toBe('reload')
  })
})

describe('isUpdateBannerStale', () => {
  const base = { hasWaiting: false, hasInstalling: false, isControlled: true }

  it('is stale when nothing is waiting or installing and the page is controlled', () => {
    expect(isUpdateBannerStale(base)).toBe(true)
  })

  it('is not stale while a worker is waiting to activate', () => {
    expect(isUpdateBannerStale({ ...base, hasWaiting: true })).toBe(false)
  })

  it('is not stale while a new worker is installing', () => {
    expect(isUpdateBannerStale({ ...base, hasInstalling: true })).toBe(false)
  })

  it('is not stale when the page has no controlling worker yet', () => {
    expect(isUpdateBannerStale({ ...base, isControlled: false })).toBe(false)
  })
})
