import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Team } from './espn.ts'
import { generateSummary } from './summary.ts'

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

  it('runs unbounded when no deadline is given', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(geminiText('no deadline'))))

    await expect(generateSummary(TEAM, 'key')).resolves.toBe('no deadline')
  })
})
