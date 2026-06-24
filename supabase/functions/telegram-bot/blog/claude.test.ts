import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { extractTag, formatRecap } from './claude.ts'

describe('extractTag', () => {
  it('returns inner content across newlines', () => {
    const text = 'pre <formatted_results>\nline one\nline two\n</formatted_results> post'
    expect(extractTag('formatted_results', text)).toBe('line one\nline two')
  })

  it('returns null when the tag is absent', () => {
    expect(extractTag('title_suggestions', 'no tags here')).toBeNull()
  })

  it('extracts the first match only', () => {
    expect(extractTag('t', '<t>a</t><t>b</t>')).toBe('a')
  })
})

describe('formatRecap retry', () => {
  beforeEach(() => {
    // Shim Deno.env for the Node/vitest runtime (formatRecap reads the API key).
    vi.stubGlobal('Deno', { env: { get: () => 'test-key' } })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('retries on 529 then succeeds', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 529, text: async () => 'overloaded' })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: 'FORMATTED' }] }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const promise = formatRecap('recap')
    await vi.runAllTimersAsync() // flush the backoff sleep
    await expect(promise).resolves.toBe('FORMATTED')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws with status + body after exhausting retries', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503, text: async () => 'still down' })),
    )

    const promise = formatRecap('recap')
    // Attach the rejection assertion before draining timers so the rejection is
    // observed (avoids an unhandled-rejection warning).
    const assertion = expect(promise).rejects.toThrow(/503.*still down/)
    await vi.runAllTimersAsync()
    await assertion
  })

  it('does not retry on a non-retryable error', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 400, text: async () => 'bad request' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(formatRecap('recap')).rejects.toThrow(/400/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
