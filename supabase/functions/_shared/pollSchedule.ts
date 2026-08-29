// "When should I come back?" — the single biggest reduction in ESPN traffic.
//
// The old function polled every team every 15 minutes, 96 times a day, whether
// or not anyone was playing (~864 requests/day). The scoreboard already reports
// live state per game, so we can sleep until it actually matters and keep the
// same 15-minute freshness at the end of a game (~10-20 requests/day).
//
// HOUSE RULE: zero jsr:/npm:/https:// imports, zero top-level `Deno.*`.

/** One of our team's games, normalized out of an ESPN scoreboard event. */
export type ScoreboardGame = {
  id: string
  /** ISO start time. */
  startTime: string
  state: 'pre' | 'in' | 'post'
  completed: boolean
  /** Inning / quarter / period / half, 1-based. 0 when not started. */
  period: number
  /** "12:34" — counts down in most sports, up in soccer. Null when absent. */
  displayClock: string | null
  /** ESPN status name, e.g. STATUS_SCHEDULED / STATUS_DELAYED / STATUS_POSTPONED. */
  statusName: string | null
}

type LeagueClock = {
  /** Baseball has no clock; innings are estimated at a flat rate. */
  kind: 'innings' | 'clock'
  /** Innings, quarters, periods, or halves in regulation. */
  regulation: number
  /** Game-clock minutes per period (or estimated real minutes per inning). */
  periodMinutes: number
  /** Real minutes per game-clock minute (stoppages, ads, reviews). */
  realTimeFactor: number
  /** Soccer's clock counts up rather than down. */
  countsUp?: boolean
}

const LEAGUE_CLOCKS: Record<string, LeagueClock> = {
  'mlb': { kind: 'innings', regulation: 9, periodMinutes: 20, realTimeFactor: 1 },
  'nba': { kind: 'clock', regulation: 4, periodMinutes: 12, realTimeFactor: 2.2 },
  'nhl': { kind: 'clock', regulation: 3, periodMinutes: 20, realTimeFactor: 2.0 },
  'nfl': { kind: 'clock', regulation: 4, periodMinutes: 15, realTimeFactor: 3.0 },
  'college-football': { kind: 'clock', regulation: 4, periodMinutes: 15, realTimeFactor: 3.3 },
  // Men's college basketball plays two 20-minute halves; the women's game plays
  // four 10-minute quarters.
  'mens-college-basketball': { kind: 'clock', regulation: 2, periodMinutes: 20, realTimeFactor: 1.8 },
  'womens-college-basketball': { kind: 'clock', regulation: 4, periodMinutes: 10, realTimeFactor: 1.8 },
  'usa.nwsl': { kind: 'clock', regulation: 2, periodMinutes: 45, realTimeFactor: 1.15, countsUp: true },
}

const DEFAULT_CLOCK: LeagueClock = {
  kind: 'clock',
  regulation: 4,
  periodMinutes: 15,
  realTimeFactor: 2.5,
}

/** Poll this often once the end of a game is in sight. */
export const LIVE_POLL_MINUTES = 15
/** A game is on, but there is plenty of it left. */
export const MIDGAME_POLL_MINUTES = 60
/** Delayed / postponed / suspended: do not spin on it. */
export const STALLED_POLL_MINUTES = 120
/** Never sleep longer than a day, so a schedule change is picked up. */
export const MAX_POLL_MINUTES = 24 * 60

/** Estimated real minutes remaining once we are inside this, poll every 15. */
const ENDGAME_THRESHOLD_MINUTES = 75

const STALLED_STATUSES = ['DELAY', 'POSTPONED', 'SUSPENDED', 'CANCELED', 'CANCELLED', 'RAIN']

const isStalled = (game: ScoreboardGame): boolean => {
  const name = (game.statusName ?? '').toUpperCase()
  return STALLED_STATUSES.some((token) => name.includes(token))
}

/** "12:34" → 12.57 minutes. Null for absent or non-clock values like "-". */
export function parseClockMinutes(displayClock: string | null | undefined): number | null {
  if (!displayClock) return null
  const match = String(displayClock).trim().match(/^(\d+):(\d{1,2})(?:\.\d+)?$/)
  if (!match) return null
  return Number(match[1]) + Number(match[2]) / 60
}

/**
 * Roughly how many real-world minutes are left in a game in progress.
 * Deliberately crude — it only has to answer "an hour away, or minutes away?"
 */
export function estimateRemainingMinutes(game: ScoreboardGame, league: string): number {
  const clock = LEAGUE_CLOCKS[league] ?? DEFAULT_CLOCK
  const period = Math.max(0, game.period || 0)

  if (clock.kind === 'innings') {
    // No clock to read; count whole innings left at a flat rate. Extra innings
    // land at 0, which is correct: it could end at any moment.
    return Math.max(0, clock.regulation - period) * clock.periodMinutes
  }

  if (clock.countsUp) {
    const elapsed = parseClockMinutes(game.displayClock) ?? 0
    const gameMinutes = Math.max(0, clock.regulation * clock.periodMinutes - elapsed)
    return gameMinutes * clock.realTimeFactor
  }

  const clockLeft = parseClockMinutes(game.displayClock) ?? clock.periodMinutes
  const periodsLeft = Math.max(0, clock.regulation - period)
  const gameMinutes = clockLeft + periodsLeft * clock.periodMinutes
  return gameMinutes * clock.realTimeFactor
}

/**
 * How many minutes until this team is worth checking again.
 *
 *  - a game in progress with lots left  → 60
 *  - a game in progress nearly over     → 15
 *  - delayed / postponed / suspended    → 120 (back off, don't spin)
 *  - only scheduled games               → sleep until the earliest start
 *  - nothing today                      → sleep a day
 */
export function nextPollDelayMinutes(
  games: ScoreboardGame[],
  league: string,
  now: Date,
): number {
  const live = games.filter((game) => game.state === 'in')

  if (live.some(isStalled)) return STALLED_POLL_MINUTES

  if (live.length > 0) {
    const soonest = Math.min(...live.map((game) => estimateRemainingMinutes(game, league)))
    return soonest > ENDGAME_THRESHOLD_MINUTES ? MIDGAME_POLL_MINUTES : LIVE_POLL_MINUTES
  }

  const upcoming = games.filter((game) => game.state === 'pre' && !isStalled(game))
  if (upcoming.length > 0) {
    const starts = upcoming
      .map((game) => Date.parse(game.startTime))
      .filter((time) => Number.isFinite(time))
    if (starts.length > 0) {
      const untilStart = (Math.min(...starts) - now.getTime()) / 60000
      // A start time that has passed while the game is still "pre" means a
      // pending first pitch — check back on the normal live cadence.
      return clampDelay(untilStart)
    }
  }

  // Nothing scheduled and nothing running: sleep long. Tomorrow's scoreboard
  // will list tomorrow's games as `pre` when we next look.
  return MAX_POLL_MINUTES
}

const clampDelay = (minutes: number): number =>
  Math.min(MAX_POLL_MINUTES, Math.max(LIVE_POLL_MINUTES, Math.round(minutes)))

/**
 * Stale-data detection — the check that would have caught the Aug 5 outage.
 *
 * It deliberately reads from games we recorded as EXPECTED on an earlier run,
 * not from the current response. That is the whole point: on Aug 5 the fetch
 * returned a clean 200 with nothing in it, so anything derived from the live
 * payload would also have seen nothing wrong.
 */
export const STALE_AFTER_HOURS = 6

export type ExpectedGame = {
  espn_game_id: string
  /** ISO start time, captured when the game was still scheduled or in progress. */
  start_time: string
}

/**
 * Expected games that should have finished by now and still have no result.
 * `recordedGameIds` is the set of espn_game_ids already in score_history.
 */
export function findStaleGames(
  expected: ExpectedGame[],
  recordedGameIds: Iterable<string>,
  now: Date,
): ExpectedGame[] {
  const recorded = new Set(recordedGameIds)
  const cutoff = now.getTime() - STALE_AFTER_HOURS * 60 * 60 * 1000
  return expected.filter((game) => {
    if (recorded.has(game.espn_game_id)) return false
    const start = Date.parse(game.start_time)
    return Number.isFinite(start) && start < cutoff
  })
}
