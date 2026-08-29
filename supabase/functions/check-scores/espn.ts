// ESPN scoreboard fetching and parsing.
//
// The request shape (host, User-Agent, `dates=`, `groups=`) lives in
// _shared/espnParams.ts so it can be unit-tested; this file is the I/O and the
// payload walk.

import {
  ESPN_USER_AGENT,
  buildScoreboardUrls,
  isLeagueInSeason,
} from '../_shared/espnParams.ts'
import type { ScoreboardGame } from '../_shared/pollSchedule.ts'

export type Team = {
  id: string
  name: string
  display_name: string
  sport: string
  league: string
  espn_team_id: string
  emoji_win: string
  emoji_loss: string
  emoji_tie: string
  next_poll_at: string | null
}

export type GameResult = {
  espnGameId: string
  gameDate: string
  teamScore: number
  opponentName: string
  opponentScore: number
  result: 'win' | 'loss' | 'tie'
  homeAway: 'home' | 'away'
  rawData: unknown
}

export type TeamGames = {
  /** Every game involving this team on the queried dates, live state included. */
  all: ScoreboardGame[]
  /** The subset that finished inside the lookback window and is worth emailing. */
  completed: GameResult[]
}

/**
 * A failed ESPN request. `status` is null when the request threw outright
 * (DNS, TLS, timeout) rather than returning a response.
 */
export class EspnFetchError extends Error {
  readonly status: number | null
  readonly retryAfter: string | null

  constructor(message: string, status: number | null, retryAfter: string | null = null) {
    super(message)
    this.name = 'EspnFetchError'
    this.status = status
    this.retryAfter = retryAfter
  }
}

/** Per-run cache so two teams in the same league share one request. */
export type ScoreboardCache = Map<string, unknown[]>

export const createScoreboardCache = (): ScoreboardCache => new Map()

async function fetchScoreboardEvents(url: string, cache: ScoreboardCache): Promise<unknown[]> {
  const cached = cache.get(url)
  if (cached) return cached

  let resp: Response
  try {
    resp = await fetch(url, {
      headers: {
        'User-Agent': ESPN_USER_AGENT,
        'Accept': 'application/json',
      },
    })
  } catch (err) {
    throw new EspnFetchError(`ESPN request failed: ${String(err)}`, null)
  }

  if (!resp.ok) {
    // Drain the body so the connection can be reused/closed cleanly.
    await resp.text().catch(() => '')
    throw new EspnFetchError(
      `ESPN ${resp.status} for ${url}`,
      resp.status,
      resp.headers.get('retry-after'),
    )
  }

  const data = await resp.json()
  const events = Array.isArray(data?.events) ? data.events : []
  cache.set(url, events)
  return events
}

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null

/** Pull the score out of either shape: `{value: 1.0}` (schedule) or `"1"` (scoreboard). */
const readScore = (competitor: any): number => {
  const raw = competitor?.score?.value ?? competitor?.score ?? '0'
  const parsed = parseInt(String(raw), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Every game involving `team` across the lookback dates, plus the completed
 * ones inside `lookbackMs`.
 *
 * Throws EspnFetchError on any failed request — the caller records that as a
 * breaker failure rather than silently reporting "no games", which is exactly
 * how the Aug 2026 outage stayed invisible for three weeks.
 */
export async function fetchTeamGames(
  team: Team,
  now: Date,
  cache: ScoreboardCache,
  lookbackMs = 24 * 60 * 60 * 1000,
): Promise<TeamGames> {
  if (!isLeagueInSeason(team.league, now)) {
    return { all: [], completed: [] }
  }

  const urls = buildScoreboardUrls(team.sport, team.league, now)
  const events: unknown[] = []
  for (const url of urls) {
    events.push(...(await fetchScoreboardEvents(url, cache)))
  }

  const all: ScoreboardGame[] = []
  const completed: GameResult[] = []
  const cutoff = now.getTime() - lookbackMs
  const seen = new Set<string>()

  for (const event of events as any[]) {
    const competition = event?.competitions?.[0]
    if (!competition) continue

    const competitors = competition.competitors ?? []
    const ourTeam = competitors.find((c: any) => String(c?.team?.id) === team.espn_team_id)
    if (!ourTeam) continue

    const espnGameId = String(event.id)
    if (seen.has(espnGameId)) continue // same game on both queried dates
    seen.add(espnGameId)

    const statusType = competition.status?.type ?? {}
    all.push({
      id: espnGameId,
      startTime: asString(event.date) ?? new Date(0).toISOString(),
      state: (statusType.state === 'in' || statusType.state === 'post') ? statusType.state : 'pre',
      completed: statusType.completed === true,
      period: Number(competition.status?.period ?? 0) || 0,
      displayClock: asString(competition.status?.displayClock),
      statusName: asString(statusType.name) ?? asString(statusType.description),
    })

    if (statusType.completed !== true) continue

    const gameTime = Date.parse(event.date)
    if (!Number.isFinite(gameTime) || gameTime < cutoff) continue

    const opponent = competitors.find((c: any) => String(c?.team?.id) !== team.espn_team_id)
    if (!opponent) continue

    completed.push({
      espnGameId,
      gameDate: String(event.date ?? '').split('T')[0] ?? '',
      teamScore: readScore(ourTeam),
      opponentName: opponent.team?.displayName ?? 'Unknown',
      opponentScore: readScore(opponent),
      result: ourTeam.winner === true ? 'win' : opponent.winner === true ? 'loss' : 'tie',
      homeAway: ourTeam.homeAway === 'away' ? 'away' : 'home',
      rawData: event,
    })
  }

  return { all, completed }
}
