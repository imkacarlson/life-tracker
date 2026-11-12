import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Team } from './espn.ts'
import {
  NEWS_MAX_CHARS,
  SUMMARY_ATTEMPT_TIMEOUT_MS,
  type GeminiAttempt,
  generateSummary,
  parseInsight,
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

/** A well-formed Gemini answer, tagged so each test's result is distinguishable. */
const answer = (tag: string) => `{"playoff_odds_pct": 42, "news": "News ${tag}."}`

/** What generateSummary returns (and index.ts stores) for answer(tag). */
const stored = (tag: string) => JSON.stringify({ playoff_odds_pct: 42, news: `News ${tag}.` })

describe('parseInsight', () => {
  it('reads a clean JSON answer', () => {
    expect(parseInsight('{"playoff_odds_pct": 49, "news": "Haliburton is out."}')).toEqual({
      playoff_odds_pct: 49,
      news: 'Haliburton is out.',
    })
  })

  it('finds the object inside code fences or prose', () => {
    const text = 'Here you go:\n```json\n{"playoff_odds_pct": 70, "news": "Ovechkin tied a record."}\n```'
    expect(parseInsight(text)?.playoff_odds_pct).toBe(70)
  })

  it('rounds odds to a whole number and accepts "49%"', () => {
    expect(parseInsight('{"playoff_odds_pct": 6.3, "news": "x"}')?.playoff_odds_pct).toBe(6)
    expect(parseInsight('{"playoff_odds_pct": "49%", "news": "x"}')?.playoff_odds_pct).toBe(49)
  })

  it('drops odds outside 0-100', () => {
    expect(parseInsight('{"playoff_odds_pct": 140, "news": "x"}')?.playoff_odds_pct).toBeNull()
  })

  it('keeps news when odds are null (offseason, early season)', () => {
    expect(parseInsight('{"playoff_odds_pct": null, "news": "Signed a new deal."}')).toEqual({
      playoff_odds_pct: null,
      news: 'Signed a new deal.',
    })
  })

  it('cuts overlong news to its first sentence', () => {
    // A real 2026-11-12 Capitals answer: two items in one line, over the limit.
    const long = 'Alex Ovechkin tied the franchise assists record (762) on Tuesday night. ' +
      'Rookie Cole Hutson scored an overtime winner, and Rasmus Sandin is nearing a return from injury.'
    expect(long.length).toBeGreaterThan(NEWS_MAX_CHARS)
    expect(parseInsight(`{"playoff_odds_pct": 70, "news": ${JSON.stringify(long)}}`)?.news).toBe(
      'Alex Ovechkin tied the franchise assists record (762) on Tuesday night.',
    )
  })

  it('drops news that is one overlong sentence', () => {
    const long = 'word '.repeat(50).trim()
    expect(parseInsight(`{"playoff_odds_pct": 10, "news": "${long}"}`)).toEqual({
      playoff_odds_pct: 10,
      news: null,
    })
  })

  it('returns null for old plain-text summaries and junk', () => {
    expect(parseInsight('Record & Standings: 4-7, 10th in the East.')).toBeNull()
    expect(parseInsight('{not json}')).toBeNull()
    expect(parseInsight('{"playoff_odds_pct": null, "news": ""}')).toBeNull()
    expect(parseInsight(null)).toBeNull()
  })

  it('reads back what generateSummary stores', () => {
    expect(parseInsight(stored('A'))).toEqual({ playoff_odds_pct: 42, news: 'News A.' })
  })
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

  it('returns the parsed odds and news on a normal response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(geminiText(answer('A')))),
    )

    await expect(generateSummary(TEAM, 'key', Date.now() + 5_000)).resolves.toBe(
      stored('A'),
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

  it('retries when Gemini answers in prose instead of JSON', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(geminiText('The Pacers are 4-8 and their odds are 49%.')))
      .mockResolvedValueOnce(jsonResponse(geminiText(answer('retry'))))
    vi.stubGlobal('fetch', fetchSpy)
    const attempts: GeminiAttempt[] = []

    await expect(
      generateSummary(TEAM, 'key', Date.now() + 10_000, (a) => attempts.push(a)),
    ).resolves.toBe(stored('retry'))
    expect(attempts[0]).toMatchObject({ outcome: 'empty' })
    expect(attempts[0].errorDetail).toContain('unparseable')
  })

  it('joins an answer split across several parts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      candidates: [{ content: { parts: [{ text: '{"playoff_odds_pct": 42, ' }, { text: '"news": "News split."}' }] } }],
    })))

    await expect(generateSummary(TEAM, 'key', Date.now() + 5_000)).resolves.toBe(stored('split'))
  })

  it('asks for JSON with the right playoff target and today\'s date', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(geminiText(answer('A'))))
    vi.stubGlobal('fetch', fetchSpy)

    await generateSummary(TEAM, 'key', Date.now() + 5_000)

    const prompt: string = JSON.parse(fetchSpy.mock.calls[0][1].body).contents[0].parts[0].text
    expect(prompt).toContain('"playoff_odds_pct"')
    expect(prompt).toContain('the College Football Playoff')
    expect(prompt).toMatch(/Today is \w+ \d+, \d{4}/)
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
      .mockResolvedValueOnce(jsonResponse(geminiText(answer('B'))))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(generateSummary(TEAM, 'key', Date.now() + 10_000)).resolves.toBe(
      stored('B'),
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
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(geminiText(answer('C')))))
      const { attempts, record } = collect()

      await expect(generateSummary(TEAM, 'key', Date.now() + 5_000, record)).resolves.toBe(
        stored('C'),
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
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(geminiText(answer('D')))))

      await expect(generateSummary(TEAM, 'key', Date.now() + 5_000)).resolves.toBe(stored('D'))
    })
  })

  it('runs unbounded when no deadline is given', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(geminiText(answer('E')))))

    await expect(generateSummary(TEAM, 'key')).resolves.toBe(stored('E'))
  })
})
