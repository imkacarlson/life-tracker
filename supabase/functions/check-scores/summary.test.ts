import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Team } from './espn.ts'
import { SUMMARY_ATTEMPT_TIMEOUT_MS, generateSummary } from './summary.ts'

const TEAM = {
  id: 'team-1',
  name: 'iu_football',
  display_name: 'Indiana Hoosiers Football',
  sport: 'football',
  league: 'college-football',
  espn_team_id: '84',
  emoji_win: '🏈🏆',
  emoji_loss: '🏈❌',
  emoji_tie: '🏈🤝',
  next_poll_at: null,
} satisfies Team

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })

const geminiText = (text: string) => ({
  candidates: [{ content: { parts: [{ text }] } }],
})

/** A request that never settles on its own — only the abort signal ends it. */
const hangingFetch = vi.fn((_url: string, init: RequestInit) => {
  return new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => {
      reject(Object.assign(new Error('The signal has been aborted'), { name: 'AbortError' }))
    })
  })
})

describe('generateSummary', () => {
  beforeEach(() => {
    // The retry path logs on every failure; keep the test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    hangingFetch.mockClear()
  })

  it('returns the text on a normal response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(geminiText('Record: 1-0. Next: Saturday.'))),
    )

    await expect(generateSummary(TEAM, 'key', Date.now() + 5_000)).resolves.toBe(
      'Record: 1-0. Next: Saturday.',
    )
  })

  it('gives up on a hung request instead of running past the deadline', async () => {
    // The 2026-09-05 failure: Gemini accepted the connection and never answered.
    // Unbounded, three of these outlived the 150s worker and the email was lost.
    vi.stubGlobal('fetch', hangingFetch)

    const deadline = Date.now() + 300
    await expect(generateSummary(TEAM, 'key', deadline)).resolves.toBeNull()
    // Comfortably inside the worker budget, which is the whole point.
    expect(Date.now()).toBeLessThan(deadline + 500)
  })

  it('does not call Gemini at all when the budget is already spent', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(geminiText('unused')))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(generateSummary(TEAM, 'key', Date.now() - 1)).resolves.toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does not burn retries on a permanent 4xx', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ error: 'bad key' }, 403))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(generateSummary(TEAM, 'key', Date.now() + 5_000)).resolves.toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('retries a 503 and succeeds on a later attempt', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'unavailable' }, 503))
      .mockResolvedValueOnce(jsonResponse(geminiText('Second attempt worked.')))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(generateSummary(TEAM, 'key', Date.now() + 10_000)).resolves.toBe(
      'Second attempt worked.',
    )
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  // The 2026-09-07 regression: a 15s cap sat inside normal grounded latency, so
  // all three attempts aborted and every email went out bare. Retrying a timeout
  // just re-waits for the same slow answer, so one attempt has to settle it.
  //
  // These reject INSTANTLY rather than hanging, deliberately: a hung request
  // consumes the whole remaining budget by construction, so the old retry-
  // everything code would not have retried it either and the test would pass
  // against the bug. Leaving budget on the table is what makes these discriminate
  // — under the old behavior each would have called fetch three times.
  it.each([
    // Deno's AbortSignal.timeout rejects with TimeoutError...
    ['TimeoutError', 'Signal timed out.'],
    // ...while an explicit abort raises AbortError. Both must be terminal.
    ['AbortError', 'The signal has been aborted'],
  ])('does not retry after a %s', async (name, message) => {
    const fetchSpy = vi.fn(async () => {
      throw Object.assign(new Error(message), { name })
    })
    vi.stubGlobal('fetch', fetchSpy)

    await expect(generateSummary(TEAM, 'key', Date.now() + 30_000)).resolves.toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('bounds an attempt by the remaining budget, not the full attempt cap', async () => {
    // A per-game slice smaller than the cap has to win, or the run ceiling means
    // nothing and a multi-game tick can outlive the worker.
    vi.stubGlobal('fetch', hangingFetch)

    const startedAt = Date.now()
    await expect(generateSummary(TEAM, 'key', Date.now() + 250)).resolves.toBeNull()
    expect(Date.now() - startedAt).toBeLessThan(SUMMARY_ATTEMPT_TIMEOUT_MS)
  })

  it('runs unbounded when no deadline is given', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(geminiText('no deadline'))))

    await expect(generateSummary(TEAM, 'key')).resolves.toBe('no deadline')
  })
})
