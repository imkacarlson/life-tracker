// Standings and next-game data for the score email card.
//
// Both come straight from ESPN JSON, never from Gemini, so the numbers on the
// card are exact. Everything here is best-effort: a failed or slow request just
// leaves that section off the email. The score is the product.
//
// The parsers are pure (plain JSON in, plain objects out) so they can be unit
// tested with saved ESPN payloads.
//
// HOUSE RULE: zero jsr:/npm:/https:// imports, zero top-level `Deno.*`.

import { ESPN_HOST, ESPN_USER_AGENT } from '../_shared/espnParams.ts'
import type { Team } from './espn.ts'

/**
 * One request's cap. All three requests run in parallel, so this is also the
 * most the card can add to one email's send time. Kept short because the edge
 * worker is killed at 150s and the run budget in index.ts assumes ~30s of
 * non-Gemini work.
 */
const CONTEXT_FETCH_TIMEOUT_MS = 5_000

/** How many standings rows the card shows around the team. */
export const STANDINGS_WINDOW = 8

export type StandingsRow = {
  rank: number
  name: string
  record: string
  /** Games back for W-L leagues, points for points leagues. */
  extra: string
  isUs: boolean
  isLastOpponent: boolean
}

export type CutLine = {
  /** The line is drawn under the row with this rank. */
  afterRank: number
  /** Names the zone BELOW the line. */
  label: string
  /** 'out' lines are drawn grey, others amber. */
  kind: 'zone' | 'out'
}

export type Standings = {
  /** Short group name for the tile, e.g. "East", "AFC", "Big Ten". */
  groupLabel: string
  /** Full group name for the table header, e.g. "Eastern Conference". */
  groupName: string
  /** One line explaining the cut lines, e.g. "1–6 in · 7–10 play-in". */
  legend: string | null
  /** Header for the third column. */
  extraLabel: 'GB' | 'PTS'
  rows: StandingsRow[]
  cutLines: CutLine[]
  ourRank: number | null
  streak: string | null
  gamesBack: string | null
  points: string | null
}

export type NextGame = {
  startTime: string
  /** False when ESPN has a date but no kickoff time yet (common in college). */
  timeValid: boolean
  homeAway: 'home' | 'away'
  opponentName: string
  opponentLogo: string | null
  venue: string | null
  /** "Spring training", "Preseason", "Playoffs", or null for the regular season. */
  seasonLabel: string | null
}

export type TeamContext = {
  standings: Standings | null
  nextGame: NextGame | null
}

// --- Per-league rules -------------------------------------------------------

type LeagueRule = {
  cutLines: CutLine[]
  legend: string | null
  /** Points leagues rank by points, so the third column shows points. */
  usesPoints: boolean
  /** Third number in the record: OT losses (NHL) or ties (soccer, NFL if any). */
  recordThird: 'otLosses' | 'ties' | null
}

const LEAGUE_RULES: Record<string, LeagueRule> = {
  nba: {
    cutLines: [
      { afterRank: 6, label: 'Play-in', kind: 'zone' },
      { afterRank: 10, label: 'Out', kind: 'out' },
    ],
    legend: '1–6 in · 7–10 play-in',
    usesPoints: false,
    recordThird: null,
  },
  nhl: {
    cutLines: [{ afterRank: 8, label: 'Out', kind: 'out' }],
    legend: 'Top 8 make it',
    usesPoints: true,
    recordThird: 'otLosses',
  },
  nfl: {
    cutLines: [{ afterRank: 7, label: 'Out', kind: 'out' }],
    legend: 'Top 7 make it',
    usesPoints: false,
    recordThird: 'ties',
  },
  mlb: {
    cutLines: [{ afterRank: 6, label: 'Out', kind: 'out' }],
    legend: 'Top 6 make it',
    usesPoints: false,
    recordThird: null,
  },
  'usa.nwsl': {
    cutLines: [{ afterRank: 8, label: 'Out', kind: 'out' }],
    legend: 'Top 8 make it',
    usesPoints: true,
    recordThird: 'ties',
  },
}

// College: conference finish does not decide the CFP or the NCAA tournament,
// so no cut lines and no legend.
const COLLEGE_RULE: LeagueRule = {
  cutLines: [],
  legend: null,
  usesPoints: false,
  recordThird: null,
}

const ruleFor = (league: string): LeagueRule => LEAGUE_RULES[league] ?? COLLEGE_RULE

// --- Standings parsing ------------------------------------------------------

/** First stat with this name. College entries repeat names (overall, then conference splits). */
const findStat = (entry: any, name: string): any =>
  (entry?.stats ?? []).find((s: any) => s?.name === name)

const statNumber = (entry: any, name: string): number | null => {
  const v = Number(findStat(entry, name)?.value)
  return Number.isFinite(v) ? v : null
}

const statDisplay = (entry: any, name: string): string | null => {
  const v = findStat(entry, name)?.displayValue
  return typeof v === 'string' && v && v !== '-' ? v : null
}

/** Walk ESPN's nested groups and return every group that has entries. */
function collectGroups(node: any, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node.standings?.entries)) out.push(node)
  for (const child of node.children ?? []) collectGroups(child, out)
  return out
}

function buildRecord(entry: any, rule: LeagueRule): string {
  const w = statNumber(entry, 'wins')
  const l = statNumber(entry, 'losses')
  if (w === null || l === null) return statDisplay(entry, 'overall') ?? '—'
  let record = `${w}–${l}`
  if (rule.recordThird) {
    const third = statNumber(entry, rule.recordThird)
    // NFL ties are rare; only show the third number when there is one.
    if (third !== null && (third > 0 || rule.recordThird === 'otLosses' || rule.usesPoints)) {
      record += `–${third}`
    }
  }
  return record
}

/** Short tile label for a group: "East", "AFC", "NL", "Big Ten", "NWSL". */
function groupShortLabel(group: any, league: string): string {
  if (typeof group?.shortName === 'string' && group.shortName) return group.shortName
  const abbr = typeof group?.abbreviation === 'string' ? group.abbreviation : ''
  // NWSL's "abbreviation" is the season year; college's is a slug like "big10".
  if (abbr && !/^\d+$/.test(abbr) && !/^[a-z0-9]+$/.test(abbr)) return abbr
  if (league === 'usa.nwsl') return 'NWSL'
  return typeof group?.name === 'string' ? group.name : ''
}

/**
 * Turn an ESPN standings payload into the card's table: the group our team is
 * in, sorted by seed, trimmed to a window of rows around the team.
 */
export function parseStandings(
  json: unknown,
  league: string,
  teamId: string,
  lastOpponentId: string | null,
): Standings | null {
  const group = collectGroups(json).find((g) =>
    g.standings.entries.some((e: any) => String(e?.team?.id) === teamId),
  )
  if (!group) return null

  const rule = ruleFor(league)
  const entries: any[] = [...group.standings.entries]

  // Seed order when every team has one; ESPN's own order otherwise (early
  // college season, where unplayed teams sit at seed 0).
  const seedOf = (e: any) => statNumber(e, 'playoffSeed') ?? statNumber(e, 'rank') ?? 0
  if (entries.every((e) => seedOf(e) > 0)) {
    entries.sort((a, b) => seedOf(a) - seedOf(b))
  }

  const rows: StandingsRow[] = entries.map((e, i) => ({
    rank: i + 1,
    name: e?.team?.shortDisplayName ?? e?.team?.displayName ?? '?',
    record: buildRecord(e, rule),
    extra: rule.usesPoints
      ? String(statNumber(e, 'points') ?? '—')
      : statDisplay(e, 'gamesBehind') ?? '—',
    isUs: String(e?.team?.id) === teamId,
    isLastOpponent: lastOpponentId !== null && String(e?.team?.id) === lastOpponentId,
  }))

  const ourIndex = rows.findIndex((r) => r.isUs)
  const ourEntry = entries[ourIndex]

  // Window: a few rows above us, the rest below, clamped to the table's ends.
  const start = Math.max(0, Math.min(ourIndex - 4, rows.length - STANDINGS_WINDOW))
  const windowRows = rows.slice(start, start + STANDINGS_WINDOW)
  const first = windowRows[0]?.rank ?? 0
  const last = windowRows[windowRows.length - 1]?.rank ?? 0

  return {
    groupLabel: groupShortLabel(group, league),
    groupName: typeof group.name === 'string' ? group.name : '',
    legend: rule.legend,
    extraLabel: rule.usesPoints ? 'PTS' : 'GB',
    rows: windowRows,
    // Only lines that fall between two visible rows.
    cutLines: rule.cutLines.filter((c) => c.afterRank >= first && c.afterRank < last),
    ourRank: ourIndex >= 0 ? ourIndex + 1 : null,
    streak: statDisplay(ourEntry, 'streak'),
    gamesBack: statDisplay(ourEntry, 'gamesBehind'),
    points: rule.usesPoints ? (statNumber(ourEntry, 'points')?.toString() ?? null) : null,
  }
}

// --- Next game parsing ------------------------------------------------------

function seasonLabel(event: any, league: string): string | null {
  const type = Number(event?.seasonType?.type)
  if (type === 1) return league === 'mlb' ? 'Spring training' : 'Preseason'
  if (type === 3) return 'Playoffs'
  return null
}

/**
 * The first game after `now` that is not finished and is not the game this
 * email is about. Accepts a schedule's `events` or a team's `nextEvent` array.
 */
export function parseNextGame(
  events: unknown,
  league: string,
  teamId: string,
  now: Date,
  excludeGameId: string,
): NextGame | null {
  if (!Array.isArray(events)) return null

  const upcoming = events
    .filter((e: any) => {
      const t = Date.parse(e?.date)
      const done = e?.competitions?.[0]?.status?.type?.completed === true
      return Number.isFinite(t) && t > now.getTime() && !done && String(e?.id) !== excludeGameId
    })
    .sort((a: any, b: any) => Date.parse(a.date) - Date.parse(b.date))

  const event: any = upcoming[0]
  const comp = event?.competitions?.[0]
  if (!comp) return null

  const competitors: any[] = comp.competitors ?? []
  const us = competitors.find((c) => String(c?.team?.id) === teamId)
  const opp = competitors.find((c) => String(c?.team?.id) !== teamId)
  if (!us || !opp) return null

  const logo = opp.team?.logos?.[0]?.href ?? opp.team?.logo ?? null

  return {
    startTime: event.date,
    timeValid: comp.timeValid !== false,
    homeAway: us.homeAway === 'away' ? 'away' : 'home',
    opponentName: opp.team?.displayName ?? 'TBD',
    opponentLogo: typeof logo === 'string' && logo.startsWith('https://') ? logo : null,
    venue: comp.venue?.fullName ?? null,
    seasonLabel: seasonLabel(event, league),
  }
}

// --- Fetching ---------------------------------------------------------------

async function getJson(url: string): Promise<unknown | null> {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': ESPN_USER_AGENT, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(CONTEXT_FETCH_TIMEOUT_MS),
    })
    if (!resp.ok) {
      await resp.text().catch(() => '')
      console.error(`Card data: ESPN ${resp.status} for ${url}`)
      return null
    }
    return await resp.json()
  } catch (err) {
    console.error(`Card data: request failed for ${url}:`, err)
    return null
  }
}

/**
 * Standings and next game for the email card. Never throws; a missing piece is
 * null and the email leaves that section out.
 */
export async function fetchTeamContext(
  team: Team,
  gameId: string,
  lastOpponentId: string | null,
  now: Date,
): Promise<TeamContext> {
  const base = `${ESPN_HOST}/apis/site/v2/sports/${team.sport}/${team.league}/teams/${team.espn_team_id}`

  // The team endpoint is only a fallback, but fetching it up front keeps the
  // worst case at one timeout instead of two.
  const [standingsJson, scheduleJson, teamJson] = await Promise.all([
    getJson(`${ESPN_HOST}/apis/v2/sports/${team.sport}/${team.league}/standings`),
    getJson(`${base}/schedule`),
    getJson(base),
  ])

  // The schedule only lists the current season type, so a playoff game can be
  // missing from it (the Spirit on 2026-11-12). The team endpoint's
  // `nextEvent` covers that case.
  const nextGame =
    parseNextGame((scheduleJson as any)?.events, team.league, team.espn_team_id, now, gameId) ??
    parseNextGame((teamJson as any)?.team?.nextEvent, team.league, team.espn_team_id, now, gameId)

  return {
    standings: standingsJson
      ? parseStandings(standingsJson, team.league, team.espn_team_id, lastOpponentId)
      : null,
    nextGame,
  }
}
