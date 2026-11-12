// Gemini-generated team blurb attached to each score email.

import type { Team } from './espn.ts'

// PINNED, do not "upgrade". This needs Google Search grounding (see the
// tools: [{ google_search: {} }] below) and the free tier does not serve
// grounding on any 3.x model — every one of them returns 429 RESOURCE_EXHAUSTED
// the moment the tool is requested, while 2.5-flash returns grounded results
// normally. Verified against the live API. Plain (ungrounded) 3.x generation is
// fine on the same key, which is why the reminder-intent classifier can run on
// 3.5-flash-lite.
const GEMINI_MODEL = 'gemini-2.5-flash'

// Gemini occasionally returns a transient 5xx/429 or an empty 200 body, so a
// couple of retries with a short backoff usually recovers the summary.
//
// This ladder is for FAST failures only. A timeout returns immediately instead
// of retrying (see the catch below), so the worst case here is three cheap
// errors, not three slow ones.
const GEMINI_MAX_ATTEMPTS = 3

/**
 * Hard cap on ONE Gemini attempt.
 *
 * Load-bearing: on 2026-09-05 three 503s hung ~45s each and the 150s edge worker
 * was killed mid-retry, after the score row had committed but before the email
 * went out. The summary is decoration; the email is the product.
 *
 * This was 15s until 2026-09-12, which was inside normal latency rather than
 * outside it: grounded 2.5-flash measures 4.5-12.1s from a laptop, and EVERY
 * production attempt from 2026-09-07 on timed out at 15s (9 of 9, with no 429s
 * and no 5xx), so the edge worker is slower still. Being this generous is only
 * affordable because a timeout no longer costs three attempts.
 */
export const SUMMARY_ATTEMPT_TIMEOUT_MS = 45_000

/**
 * Cap on the ungrounded diagnostic probe fired after a timeout.
 *
 * Short on purpose. It may push one game up to this much past its deadline —
 * worst case ~10s across a two-game tick, against ~30s of non-Gemini work and a
 * 150s worker limit, so ~20s of margin remains. Worth it: this probe is the only
 * evidence that distinguishes "grounding is wedged" from "this worker cannot
 * reach Google at all".
 */
export const UNGROUNDED_PROBE_TIMEOUT_MS = 5_000

/** One Gemini call's outcome, durable so the NEXT failure is diagnosable. */
export type GeminiAttempt = {
  attempt: number
  /** False only for the diagnostic probe below. */
  grounded: boolean
  outcome: 'answered' | 'empty' | 'http_error' | 'timeout' | 'network_error'
  statusCode: number | null
  /**
   * Time to response HEADERS. `fetch` resolves here; reading the body is a
   * second wait. Null means we never got headers at all — which separates
   * "Google never answered" from "Google answered then stalled", a distinction
   * a single elapsed number cannot make.
   */
  headersMs: number | null
  totalMs: number
  errorName: string | null
  errorDetail: string | null
}

export type AttemptRecorder = (attempt: GeminiAttempt) => void

/**
 * Gemini supplies only two things for the email card: playoff odds and one line
 * of news. Record, standings and the next game come from ESPN (teamContext.ts).
 *
 * The answer must be JSON, but the API rejects `responseMimeType: json` when the
 * search tool is on ("Tool use with a response mime type: 'application/json' is
 * unsupported", verified 2026-11-12). So the prompt asks for JSON and
 * parseInsight() checks what comes back.
 */
const GEMINI_PROMPT_TEMPLATE = (teamFullName: string, sport: string, playoffs: string, today: string) =>
  `Search the web for the latest on the ${teamFullName} (${sport}). Today is ${today}.\n` +
  `Reply with ONLY one JSON object, no markdown, no code fences, no other text:\n` +
  `{"playoff_odds_pct": <number 0-100 or null>, "news": <string>}\n` +
  `playoff_odds_pct: the current chance they make ${playoffs}. Prefer a published projection model ` +
  `(e.g. ESPN BPI/FPI, MoneyPuck, FanGraphs). If there is none, convert current sportsbook or prediction-market ` +
  `odds (e.g. DraftKings, FanDuel, Kalshi) to an implied probability. If they have already clinched, use 100. ` +
  `If they are eliminated, or the season is over, or no number is published, use null. Never estimate it yourself.\n` +
  `news: ONE sentence, at most 140 characters, the most notable recent team news (injuries, trades, streaks, milestones). ` +
  `Do not restate a game score or the team's record.`

/** What each league's "playoffs" means, for the odds question. */
const PLAYOFF_TARGETS: Record<string, string> = {
  'mlb': 'the MLB postseason',
  'nba': 'the NBA playoffs (including by winning the play-in tournament)',
  'nhl': 'the Stanley Cup playoffs',
  'nfl': 'the NFL playoffs',
  'college-football': 'the College Football Playoff',
  'mens-college-basketball': 'the NCAA tournament',
  'womens-college-basketball': 'the NCAA tournament',
  'usa.nwsl': 'the NWSL playoffs',
}

const playoffTarget = (team: Team): string => PLAYOFF_TARGETS[team.league] ?? 'the playoffs'

/** "November 12, 2026" in Eastern time, so the model knows how fresh to be. */
const easternToday = (now: Date): string =>
  now.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

/** The two facts the email card takes from Gemini. Either may be missing. */
export type Insight = {
  playoff_odds_pct: number | null
  news: string | null
}

/** Longest news line the card will show. Gemini is asked for 140. */
export const NEWS_MAX_CHARS = 160

/** Keep the first sentence if the whole thing is too long; drop it if that is too. */
function cleanNews(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let news = raw.replace(/\s+/g, ' ').trim()
  if (!news) return null
  if (news.length > NEWS_MAX_CHARS) {
    const firstSentence = news.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? ''
    news = firstSentence
  }
  return news && news.length <= NEWS_MAX_CHARS ? news : null
}

function cleanOdds(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  // Tolerate "49%" as well as 49.
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw))
  if (!Number.isFinite(n) || n < 0 || n > 100) return null
  return Math.round(n)
}

/**
 * Read Gemini's answer (or a stored ai_summary) into an Insight.
 *
 * Returns null when there is nothing usable: no JSON object, unparseable JSON,
 * or neither field survived cleaning. Old plain-text summaries also land here.
 */
export function parseInsight(text: string | null | undefined): Insight | null {
  if (!text) return null
  // Gemini sometimes wraps the object in prose or ``` fences despite the prompt.
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null

  let obj: any
  try {
    obj = JSON.parse(match[0])
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null

  const insight: Insight = {
    playoff_odds_pct: cleanOdds(obj.playoff_odds_pct),
    news: cleanNews(obj.news),
  }
  if (insight.playoff_odds_pct === null && insight.news === null) return null
  return insight
}

const SPORT_LABELS: Record<string, string> = {
  'baseball': 'MLB baseball',
  'basketball': 'NBA',
  'hockey': 'NHL',
  'football': 'NFL',
  'soccer': "women's soccer",
}

export function sportLabel(team: Team): string {
  if (team.league === 'college-football') return 'NCAA football'
  if (team.league === 'mens-college-basketball') return "NCAA men's basketball"
  if (team.league === 'womens-college-basketball') return "NCAA women's basketball"
  return SPORT_LABELS[team.sport] ?? team.sport
}

const endpoint = (apiKey: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`

const errorName = (err: unknown): string =>
  (err as { name?: string } | null)?.name ?? 'unknown'

/** True when OUR abort signal ended the request, rather than the network. */
const isTimeout = (name: string) => name === 'TimeoutError' || name === 'AbortError'

/**
 * The same call without `tools`, fired immediately after a grounded timeout.
 *
 * Diagnostic ONLY. Its text is deliberately discarded and never becomes the
 * summary: the prompt demands sourced, non-hallucinated content, and an
 * ungrounded blurb about a live season invents records and scores. What matters
 * is whether it answers at all, in the same worker at the same instant:
 *   answers fast -> key, network and worker are fine; grounding is wedged.
 *   also hangs    -> not grounding; this worker cannot reach Google.
 */
async function probeUngrounded(
  apiKey: string,
  prompt: string,
  attempt: number,
  record: AttemptRecorder,
): Promise<void> {
  const started = Date.now()
  let headersMs: number | null = null

  try {
    const resp = await fetch(endpoint(apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      signal: AbortSignal.timeout(UNGROUNDED_PROBE_TIMEOUT_MS),
    })
    headersMs = Date.now() - started

    const raw = await resp.text()
    let hasText = false
    try {
      hasText = Boolean(JSON.parse(raw)?.candidates?.[0]?.content?.parts?.[0]?.text)
    } catch {
      // Unparseable body; errorDetail below carries the prefix.
    }

    record({
      attempt,
      grounded: false,
      outcome: resp.ok ? (hasText ? 'answered' : 'empty') : 'http_error',
      statusCode: resp.status,
      headersMs,
      totalMs: Date.now() - started,
      errorName: null,
      errorDetail: resp.ok ? null : raw.slice(0, 300),
    })
  } catch (err) {
    const name = errorName(err)
    record({
      attempt,
      grounded: false,
      outcome: isTimeout(name) ? 'timeout' : 'network_error',
      statusCode: null,
      headersMs,
      totalMs: Date.now() - started,
      errorName: name,
      errorDetail: String((err as { message?: string } | null)?.message ?? err).slice(0, 300),
    })
  }
}

/**
 * Best-effort playoff odds and news line, returned as an Insight JSON string
 * (read it with parseInsight). Returns null — never throws, never blocks the
 * email — when Gemini is slow, erroring, out of budget, or not answering in JSON.
 *
 * `deadlineMs` is an epoch-ms cutoff for the WHOLE call, including retries and
 * backoff. Omit it only in tests; the function passes one on every real run.
 *
 * `record` is optional instrumentation: every attempt is reported to it,
 * including the ungrounded probe after a timeout. Kept additive so the call
 * shape and the existing tests stay valid.
 */
export async function generateSummary(
  team: Team,
  apiKey: string,
  deadlineMs?: number,
  record?: AttemptRecorder,
): Promise<string | null> {
  const prompt = GEMINI_PROMPT_TEMPLATE(
    team.display_name,
    sportLabel(team),
    playoffTarget(team),
    easternToday(new Date()),
  )
  const url = endpoint(apiKey)

  /** Milliseconds left in the budget, or null when running unbounded. */
  const remaining = (): number | null =>
    deadlineMs == null ? null : deadlineMs - Date.now()

  for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt++) {
    const left = remaining()
    if (left !== null && left <= 0) {
      // Out of budget. This is the line that turns a hung Gemini into a
      // score-only email instead of a killed worker and no email at all.
      console.error(`Gemini budget exhausted for ${team.display_name} — sending without a summary`)
      return null
    }

    const attemptStart = Date.now()
    let headersMs: number | null = null

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
        }),
        // Cap one attempt at SUMMARY_ATTEMPT_TIMEOUT_MS, or whatever is left of
        // the budget if less. An abort lands in the catch below, same as any
        // other network failure.
        signal: AbortSignal.timeout(
          left === null ? SUMMARY_ATTEMPT_TIMEOUT_MS : Math.min(SUMMARY_ATTEMPT_TIMEOUT_MS, left),
        ),
      })

      headersMs = Date.now() - attemptStart

      if (resp.ok) {
        const data = await resp.json()
        // Grounded answers can come back split across several parts.
        const parts: any[] = data.candidates?.[0]?.content?.parts ?? []
        const text = parts.map((p) => p?.text ?? '').join('') || null
        const insight = parseInsight(text)

        if (insight) {
          record?.({
            attempt,
            grounded: true,
            outcome: 'answered',
            statusCode: resp.status,
            headersMs,
            totalMs: Date.now() - attemptStart,
            errorName: null,
            errorDetail: null,
          })
          // Stored in score_history.ai_summary in the same shape Gemini uses,
          // so parseInsight() reads it back unchanged.
          return JSON.stringify(insight)
        }

        // 200 but nothing usable: no text, or text that was not the JSON we
        // asked for. Both are transient enough to be worth a retry.
        record?.({
          attempt,
          grounded: true,
          outcome: 'empty',
          statusCode: resp.status,
          headersMs,
          totalMs: Date.now() - attemptStart,
          errorName: null,
          errorDetail: text ? `unparseable: ${text.slice(0, 280)}` : null,
        })
        console.error(`Gemini empty response for ${team.display_name} after ${Date.now() - attemptStart}ms (attempt ${attempt}/${GEMINI_MAX_ATTEMPTS})`)
      } else {
        const detail = await resp.text()
        record?.({
          attempt,
          grounded: true,
          outcome: 'http_error',
          statusCode: resp.status,
          headersMs,
          totalMs: Date.now() - attemptStart,
          errorName: null,
          errorDetail: detail.slice(0, 300),
        })
        console.error(`Gemini API error for ${team.display_name}: ${resp.status} after ${Date.now() - attemptStart}ms (attempt ${attempt}/${GEMINI_MAX_ATTEMPTS})`)
        // 4xx (except 429 rate limit) are permanent — don't waste retries.
        if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) {
          return null
        }
      }
    } catch (err) {
      const elapsedMs = Date.now() - attemptStart
      const name = errorName(err)

      // Our own signal fired: the API is SLOW, not flaky. Attempt 2 would wait
      // just as long for the same answer, and three of those is what killed the
      // 2026-09-05 worker. One slow attempt is enough to conclude "no summary
      // this time" — which is why the cap above can afford to be generous.
      if (isTimeout(name)) {
        record?.({
          attempt,
          grounded: true,
          outcome: 'timeout',
          statusCode: null,
          headersMs,
          totalMs: elapsedMs,
          errorName: name,
          errorDetail: null,
        })
        console.error(
          `Gemini timed out for ${team.display_name} after ${elapsedMs}ms — sending without a summary`,
        )
        // The whole point of the instrumentation: find out, right now, whether
        // an ungrounded call from this same worker answers.
        if (record) await probeUngrounded(apiKey, prompt, attempt, record)
        return null
      }

      record?.({
        attempt,
        grounded: true,
        outcome: 'network_error',
        statusCode: null,
        headersMs,
        totalMs: elapsedMs,
        errorName: name,
        errorDetail: String((err as { message?: string } | null)?.message ?? err).slice(0, 300),
      })
      console.error(
        `Gemini call failed for ${team.display_name} after ${elapsedMs}ms (attempt ${attempt}/${GEMINI_MAX_ATTEMPTS}):`,
        err,
      )
    }

    // Linear backoff between attempts: 1s, then 2s. Skip after the last attempt,
    // and skip any sleep that would run past the budget — waiting only to bail
    // out on the far side wastes the time we are trying to protect.
    if (attempt < GEMINI_MAX_ATTEMPTS) {
      const backoff = 1000 * attempt
      const left = remaining()
      if (left !== null && left <= backoff) break
      await new Promise((resolve) => setTimeout(resolve, backoff))
    }
  }

  return null
}
