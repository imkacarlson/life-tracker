// ESPN scoreboard request building.
//
// Two data-loss bugs lived here and are fixed by this module, so both are
// covered by unit tests:
//
//  1. `dates=` is interpreted in US EASTERN time, not UTC. A 8:00pm ET game on
//     Sep 3 carries a UTC date of Sep 4, so querying by UTC date made it
//     invisible. We query TWO Eastern dates (today + yesterday) to cover the
//     overnight boundary and the 24h lookback window.
//  2. College leagues need `groups=`. Without it the scoreboard returns only
//     *featured* games and a specific school is usually missing. Filtering to
//     the school's conference both fixes that and cuts the payload ~10x.
//     Non-conference games still appear.
//
// Deliberately NOT passed: `limit`. `limit=900` perversely REDUCED college
// football from 68 events to 25.
//
// HOUSE RULE: zero jsr:/npm:/https:// imports, zero top-level `Deno.*`.

/**
 * `site.web.api.espn.com`, not `site.api.espn.com`. The latter started
 * returning 403 (Akamai) to this function on 2026-08-05.
 */
export const ESPN_HOST = 'https://site.web.api.espn.com'

/**
 * An honest, descriptive User-Agent. Deno's default is refused; we identify
 * ourselves rather than impersonating curl or a browser.
 */
export const ESPN_USER_AGENT = 'life-tracker/1.0 (+https://github.com/imkacarlson/life-tracker)'

/** ESPN conference ("group") ids for the college leagues we follow. */
export const LEAGUE_GROUPS: Record<string, string> = {
  'college-football': '5', // Big Ten
  'mens-college-basketball': '7', // Big Ten
  'womens-college-basketball': '7', // Big Ten
}

/**
 * Rough season windows by Eastern month (1-12), inclusive, used only to skip
 * asking about a league that cannot possibly have played. Generous on both
 * ends — a wrong "in season" costs one cheap request, a wrong "out of season"
 * costs a missed game.
 */
const SEASON_MONTHS: Record<string, number[]> = {
  'mlb': [3, 4, 5, 6, 7, 8, 9, 10, 11],
  'nba': [10, 11, 12, 1, 2, 3, 4, 5, 6],
  'nhl': [9, 10, 11, 12, 1, 2, 3, 4, 5, 6],
  'nfl': [8, 9, 10, 11, 12, 1, 2],
  'college-football': [8, 9, 10, 11, 12, 1],
  'mens-college-basketball': [11, 12, 1, 2, 3, 4],
  'womens-college-basketball': [11, 12, 1, 2, 3, 4],
  'usa.nwsl': [3, 4, 5, 6, 7, 8, 9, 10, 11],
}

const EASTERN = 'America/New_York'

const easternParts = (date: Date): { year: string; month: string; day: string } => {
  // en-CA gives YYYY-MM-DD ordering, but read the parts explicitly so a locale
  // surprise can never silently reorder the date.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return { year: pick('year'), month: pick('month'), day: pick('day') }
}

/** `YYYYMMDD` in US Eastern time — the format ESPN's `dates=` param expects. */
export function easternDateString(date: Date): string {
  const { year, month, day } = easternParts(date)
  return `${year}${month}${day}`
}

/** Eastern calendar month (1-12) for a given instant. */
export function easternMonth(date: Date): number {
  return Number(easternParts(date).month)
}

/**
 * The Eastern dates to query for a 24h lookback: today and yesterday, newest
 * first. Deduped, so a run that straddles nothing still asks only once.
 */
export function easternLookbackDates(now: Date): string[] {
  const today = easternDateString(now)
  const yesterday = easternDateString(new Date(now.getTime() - 24 * 60 * 60 * 1000))
  return today === yesterday ? [today] : [today, yesterday]
}

/** Could this league plausibly be playing right now? Skips pointless requests. */
export function isLeagueInSeason(league: string, now: Date): boolean {
  const months = SEASON_MONTHS[league]
  if (!months) return true // unknown league — never skip on a guess
  return months.includes(easternMonth(now))
}

/**
 * The scoreboard URL for one league on one Eastern date.
 * e.g. .../basketball/mens-college-basketball/scoreboard?dates=20260301&groups=7
 */
export function buildScoreboardUrl(sport: string, league: string, easternDate: string): string {
  const params = new URLSearchParams({ dates: easternDate })
  const group = LEAGUE_GROUPS[league]
  if (group) params.set('groups', group)
  return `${ESPN_HOST}/apis/site/v2/sports/${sport}/${league}/scoreboard?${params.toString()}`
}

/** Every scoreboard URL needed to cover the 24h lookback for one league. */
export function buildScoreboardUrls(sport: string, league: string, now: Date): string[] {
  return easternLookbackDates(now).map((date) => buildScoreboardUrl(sport, league, date))
}
