import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isTransientSupabaseError, runSupabaseQueryWithRetry } from '../supabaseRetry'

describe('supabaseRetry', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('detects transient fetch errors', () => {
    expect(isTransientSupabaseError(new Error('TypeError: Failed to fetch'))).toBe(true)
    expect(isTransientSupabaseError({ message: 'Load failed' })).toBe(true)
    expect(isTransientSupabaseError(new Error('permission denied'))).toBe(false)
  })

  it('returns immediately when the query succeeds', async () => {
    const query = vi.fn().mockResolvedValue({ data: [{ id: 1 }], error: null })

    const result = await runSupabaseQueryWithRetry(query, { retries: 2, delayMs: 1 })

    expect(result).toEqual({ data: [{ id: 1 }], error: null })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('retries transient errors and returns the later success', async () => {
    vi.useFakeTimers()
    const query = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: new Error('TypeError: Failed to fetch') })
      .mockResolvedValueOnce({ data: [{ id: 2 }], error: null })

    const resultPromise = runSupabaseQueryWithRetry(query, { retries: 2, delayMs: 10 })
    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(result).toEqual({ data: [{ id: 2 }], error: null })
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('does not retry non-transient errors', async () => {
    const query = vi.fn().mockResolvedValue({ data: null, error: new Error('permission denied') })

    const result = await runSupabaseQueryWithRetry(query, { retries: 2, delayMs: 1 })

    expect(result.error?.message).toBe('permission denied')
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('returns the final error after exhausting retries', async () => {
    vi.useFakeTimers()
    const query = vi
      .fn()
      .mockResolvedValue({ data: null, error: new Error('TypeError: Failed to fetch') })

    const resultPromise = runSupabaseQueryWithRetry(query, { retries: 2, delayMs: 10 })
    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(result.error?.message).toContain('Failed to fetch')
    expect(query).toHaveBeenCalledTimes(3)
  })
})
