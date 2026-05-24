import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withTimeout } from '../promiseTimeout'

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves with the promise value when it settles before the timeout', async () => {
    const promise = Promise.resolve('session')
    const result = await withTimeout(promise, 8000, () => 'fallback')
    expect(result).toBe('session')
  })

  it('resolves with the fallback when the promise hangs past the timeout', async () => {
    // A promise that never settles.
    const hung = new Promise(() => {})
    const onTimeout = vi.fn(() => 'fallback')
    const racePromise = withTimeout(hung, 8000, onTimeout)
    await vi.advanceTimersByTimeAsync(8000)
    const result = await racePromise
    expect(result).toBe('fallback')
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('resolves with the fallback when the promise rejects', async () => {
    const failing = Promise.reject(new Error('boom'))
    const onTimeout = vi.fn(() => 'fallback')
    const result = await withTimeout(failing, 8000, onTimeout)
    expect(result).toBe('fallback')
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('does not invoke the fallback when the promise resolves first', async () => {
    const onTimeout = vi.fn(() => 'fallback')
    const racePromise = withTimeout(Promise.resolve('ok'), 8000, onTimeout)
    await vi.advanceTimersByTimeAsync(8000)
    await racePromise
    expect(onTimeout).not.toHaveBeenCalled()
  })
})
