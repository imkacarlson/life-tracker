import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Team } from './espn.ts'
import {
  SUMMARY_ATTEMPT_TIMEOUT_MS,
  type GeminiAttempt,
  generateSummary,
} from './summary.ts'

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

  // Durable diagnostics. The point of these rows is that the NEXT production
  // failure is diagnosable without reconstructing it from expiring log lines.
  describe('attempt recording', () => {
    const collect = () => {
      const attempts: GeminiAttempt[] = []
      return { attempts, record: (a: GeminiAttempt) => attempts.push(a) }
    }

    it('records a successful call with both timings', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(geminiText('Record: 1-0.'))))
      const { attempts, record } = collect()

      await expect(generateSummary(TEAM, 'key', Date.now() + 5_000, record)).resolves.toBe(
        'Record: 1-0.',
      )

      expect(attempts).toHaveLength(1)
      expect(attempts[0]).toMatchObject({ attempt: 1, grounded: true, outcome: 'answered', statusCode: 200 })
      // headersMs must be populated and no greater than the total, or the
      // "answered then stalled" distinction is meaningless.
      expect(attempts[0].headersMs).not.toBeNull()
      expect(attempts[0].headersMs!).toBeLessThanOrEqual(attempts[0].totalMs)
    })

    it('records a timeout AND the ungrounded fallback probe', async () => {
      // Rejects instantly rather than hanging, same reasoning as the tests above.
      const fetchSpy = vi
        .fn()
        // The grounded attempt times out...
        .mockImplementationOnce(async () => {
          throw Object.assign(new Error('Signal timed out.'), { name: 'TimeoutError' })
        })
        // ...and the probe that follows answers, which is the whole finding:
        // the worker CAN reach Google, so grounding is what was wedged.
        .mockImplementationOnce(async () => jsonResponse(geminiText('ungrounded reply')))
      vi.stubGlobal('fetch', fetchSpy)
      const { attempts, record } = collect()

      await expect(generateSummary(TEAM, 'key', Date.now() + 30_000, record)).resolves.toBeNull()

      expect(attempts).toHaveLength(2)
      expect(attempts[0]).toMatchObject({ grounded: true, outcome: 'timeout', errorName: 'TimeoutError' })
      expect(attempts[1]).toMatchObject({ grounded: false, outcome: 'answered' })
      // Diagnostic only — the probe's text must never become the summary.
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    it('sends the probe without the grounding tool', async () => {
      const fetchSpy = vi
        .fn()
        .mockImplementationOnce(async () => {
          throw Object.assign(new Error('Signal timed out.'), { name: 'TimeoutError' })
        })
        .mockImplementationOnce(async () => jsonResponse(geminiText('ungrounded reply')))
      vi.stubGlobal('fetch', fetchSpy)
      const { record } = collect()

      await generateSummary(TEAM, 'key', Date.now() + 30_000, record)

      const groundedBody = JSON.parse(fetchSpy.mock.calls[0][1].body)
      const probeBody = JSON.parse(fetchSpy.mock.calls[1][1].body)
      expect(groundedBody.tools).toEqual([{ google_search: {} }])
      expect(probeBody.tools).toBeUndefined()
    })

    it('records a permanent 4xx with its status and does not retry', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'bad key' }, 403)))
      const { attempts, record } = collect()

      await expect(generateSummary(TEAM, 'key', Date.now() + 5_000, record)).resolves.toBeNull()

      expect(attempts).toHaveLength(1)
      expect(attempts[0]).toMatchObject({ grounded: true, outcome: 'http_error', statusCode: 403 })
    })

    it('works with no recorder passed', async () => {
      // The signature is additive on purpose: index.ts and every test above
      // must keep working untouched.
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(geminiText('no recorder'))))

      await expect(generateSummary(TEAM, 'key', Date.now() + 5_000)).resolves.toBe('no recorder')
    })
  })

  it('runs unbounded when no deadline is given', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(geminiText('no deadline'))))

    await expect(generateSummary(TEAM, 'key')).resolves.toBe('no deadline')
  })
})
