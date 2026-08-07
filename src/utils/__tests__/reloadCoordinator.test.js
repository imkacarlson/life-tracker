import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setBeforeReloadHandler,
  beginIntentionalReload,
  isIntentionalReload,
  __resetForTests,
} from '../reloadCoordinator'

describe('reloadCoordinator', () => {
  beforeEach(() => {
    __resetForTests()
  })

  it('starts with the latch down', () => {
    expect(isIntentionalReload()).toBe(false)
  })

  it('invokes the registered handler and latches the flag', () => {
    const handler = vi.fn()
    setBeforeReloadHandler(handler)

    beginIntentionalReload()

    expect(handler).toHaveBeenCalledTimes(1)
    expect(isIntentionalReload()).toBe(true)
  })

  it('keeps the latch up once raised', () => {
    beginIntentionalReload()
    expect(isIntentionalReload()).toBe(true)
    expect(isIntentionalReload()).toBe(true)
  })

  it('is a no-op (not a throw) when no handler is registered', () => {
    expect(() => beginIntentionalReload()).not.toThrow()
    expect(isIntentionalReload()).toBe(true)
  })

  it('detaches the handler on unsubscribe', () => {
    const handler = vi.fn()
    const unsubscribe = setBeforeReloadHandler(handler)

    unsubscribe()
    beginIntentionalReload()

    expect(handler).not.toHaveBeenCalled()
  })

  it('does not let a stale unsubscribe clobber a newer handler', () => {
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribeFirst = setBeforeReloadHandler(first)
    setBeforeReloadHandler(second)

    unsubscribeFirst()
    beginIntentionalReload()

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('__resetForTests clears both the handler and the latch', () => {
    const handler = vi.fn()
    setBeforeReloadHandler(handler)
    beginIntentionalReload()

    __resetForTests()

    expect(isIntentionalReload()).toBe(false)
    beginIntentionalReload()
    expect(handler).toHaveBeenCalledTimes(1) // only the pre-reset call
  })
})
