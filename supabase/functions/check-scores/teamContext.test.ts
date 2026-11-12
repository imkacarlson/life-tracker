import { describe, expect, it } from 'vitest'

import { STANDINGS_WINDOW, parseNextGame, parseStandings } from './teamContext.ts'

// Payloads below mirror the real ESPN shapes captured on 2026-11-12, trimmed to
// the fields the parser reads.

type StatSpec = Record<string, number | string>

const entry = (id: string, name: string, stats: StatSpec) => ({
  team: { id, shortDisplayName: name, displayName: `${name} Full` },
  stats: Object.entries(stats).map(([key, v]) => ({
    name: key,
    value: typeof v === 'number' ? v : undefined,
    displayValue: String(v),
  })),
})

/** An NBA-style conference of 15, listed by ESPN in NON-seed order. */
function nbaEast() {
  const teams = Array.from({ length: 15 }, (_, i) => {
    const seed = i + 1
    const id = seed === 10 ? '27' : seed === 12 ? '11' : `t${seed}`
    const name = seed === 10 ? 'Wizards' : seed === 12 ? 'Pacers' : `Team${seed}`
    return entry(id, name, {
      playoffSeed: seed,
      wins: 15 - seed,
      losses: seed,
      gamesBehind: seed === 1 ? '-' : String(seed - 1),
      streak: seed === 10 ? 'L2' : 'W1',
    })
  })
  return {
    children: [
      { name: 'Western Conference', abbreviation: 'West', standings: { entries: [entry('w1', 'West1', { playoffSeed: 1 })] } },
      // Reversed, as ESPN actually returns the NBA (worst first).
      { name: 'Eastern Conference', abbreviation: 'East', standings: { entries: teams.reverse() } },
    ],
  }
}

describe('parseStandings', () => {
  it('finds our conference and sorts it by seed', () => {
    const s = parseStandings(nbaEast(), 'nba', '27', null)!
    expect(s.groupName).toBe('Eastern Conference')
    expect(s.groupLabel).toBe('East')
    expect(s.ourRank).toBe(10)
    expect(s.rows.map((r) => r.rank)).toEqual([...s.rows.map((r) => r.rank)].sort((a, b) => a - b))
  })

  it('shows a window of rows around the team', () => {
    const s = parseStandings(nbaEast(), 'nba', '27', null)!
    expect(s.rows).toHaveLength(STANDINGS_WINDOW)
    expect(s.rows[0].rank).toBe(6)
    expect(s.rows.find((r) => r.isUs)?.name).toBe('Wizards')
  })

  it('clamps the window at the top of the table', () => {
    const s = parseStandings(nbaEast(), 'nba', 't1', null)!
    expect(s.rows[0].rank).toBe(1)
    expect(s.rows).toHaveLength(STANDINGS_WINDOW)
  })

  it('keeps only cut lines that fall between visible rows', () => {
    const s = parseStandings(nbaEast(), 'nba', '27', null)!
    expect(s.cutLines.map((c) => c.afterRank)).toEqual([6, 10])
    expect(parseStandings(nbaEast(), 'nba', 't1', null)!.cutLines.map((c) => c.afterRank)).toEqual([6])
  })

  it('tags the team we just played', () => {
    const s = parseStandings(nbaEast(), 'nba', '27', '11')!
    expect(s.rows.find((r) => r.isLastOpponent)?.name).toBe('Pacers')
  })

  it('reads the streak and games back for the tiles', () => {
    const s = parseStandings(nbaEast(), 'nba', '27', null)!
    expect(s.streak).toBe('L2')
    expect(s.gamesBack).toBe('9')
    expect(s.points).toBeNull()
    expect(s.extraLabel).toBe('GB')
  })

  it('uses points and W-L-OTL for the NHL', () => {
    const json = {
      children: [{
        name: 'Eastern Conference', abbreviation: 'East',
        standings: { entries: [entry('23', 'Capitals', { playoffSeed: 1, wins: 10, losses: 6, otLosses: 0, points: 20 })] },
      }],
    }
    const s = parseStandings(json, 'nhl', '23', null)!
    expect(s.rows[0].record).toBe('10–6–0')
    expect(s.rows[0].extra).toBe('20')
    expect(s.points).toBe('20')
    expect(s.extraLabel).toBe('PTS')
  })

  it('labels the NWSL table and ranks by the rank stat', () => {
    // NWSL has no playoffSeed and its "abbreviation" is the season year.
    const json = {
      name: 'NWSL Regular Season', abbreviation: '2026',
      standings: { entries: [
        entry('a', 'Gotham', { rank: 1, wins: 18, losses: 5, ties: 7, points: 61 }),
        entry('15365', 'Washington', { rank: 3, wins: 17, losses: 9, ties: 4, points: 55 }),
        entry('b', 'San Diego', { rank: 2, wins: 17, losses: 7, ties: 6, points: 57 }),
      ] },
    }
    const s = parseStandings(json, 'usa.nwsl', '15365', null)!
    expect(s.groupLabel).toBe('NWSL')
    expect(s.ourRank).toBe(3)
    expect(s.rows.map((r) => r.name)).toEqual(['Gotham', 'San Diego', 'Washington'])
    expect(s.rows[2].record).toBe('17–9–4')
  })

  it('uses the Big Ten short name and no cut lines for college', () => {
    const json = {
      children: [{
        name: 'Big Ten Conference', abbreviation: 'big10', shortName: 'Big Ten',
        standings: { entries: [
          entry('x', 'UCLA', { playoffSeed: 1, wins: 9, losses: 0 }),
          entry('84', 'Indiana', { playoffSeed: 2, wins: 8, losses: 1 }),
        ] },
      }],
    }
    const s = parseStandings(json, 'college-football', '84', null)!
    expect(s.groupLabel).toBe('Big Ten')
    expect(s.cutLines).toEqual([])
    expect(s.legend).toBeNull()
  })

  it('reads the FIRST stat when college repeats names for conference splits', () => {
    const e = entry('84', 'Indiana', { playoffSeed: 2, wins: 8, losses: 1 })
    e.stats.push({ name: 'wins', value: 5, displayValue: '5' }, { name: 'losses', value: 1, displayValue: '1' })
    const s = parseStandings({ name: 'Big Ten Conference', standings: { entries: [e] } }, 'college-football', '84', null)!
    expect(s.rows[0].record).toBe('8–1')
  })

  it('keeps ESPN order when some teams have no seed yet (early season)', () => {
    const json = {
      name: 'Big Ten Conference',
      standings: { entries: [
        entry('a', 'Rutgers', { playoffSeed: 1, wins: 3, losses: 0 }),
        entry('84', 'Indiana', { playoffSeed: 3, wins: 3, losses: 0 }),
        entry('b', 'Iowa', { playoffSeed: 0, wins: 0, losses: 0 }),
      ] },
    }
    const s = parseStandings(json, 'womens-college-basketball', '84', null)!
    expect(s.rows.map((r) => r.name)).toEqual(['Rutgers', 'Indiana', 'Iowa'])
  })

  it('returns null when the team is not in any group', () => {
    expect(parseStandings(nbaEast(), 'nba', 'nope', null)).toBeNull()
    expect(parseStandings(null, 'nba', '27', null)).toBeNull()
  })
})

const event = (id: string, date: string, opts: { completed?: boolean; homeAway?: string; seasonType?: number } = {}) => ({
  id,
  date,
  seasonType: { type: opts.seasonType ?? 2 },
  competitions: [{
    status: { type: { completed: opts.completed ?? false } },
    timeValid: true,
    venue: { fullName: 'Capital One Arena' },
    competitors: [
      { homeAway: opts.homeAway ?? 'home', team: { id: '27', displayName: 'Washington Wizards' } },
      {
        homeAway: opts.homeAway === 'away' ? 'home' : 'away',
        team: { id: '10', displayName: 'Houston Rockets', logos: [{ href: 'https://a.espncdn.com/i/teamlogos/nba/500/hou.png' }] },
      },
    ],
  }],
})

describe('parseNextGame', () => {
  const now = new Date('2026-11-13T03:00:00Z')

  it('picks the first future game', () => {
    const events = [
      event('old', '2026-11-10T00:00Z', { completed: true }),
      event('later', '2026-11-20T00:00Z'),
      event('next', '2026-11-16T00:00Z'),
    ]
    const next = parseNextGame(events, 'nba', '27', now, 'just-played')!
    expect(next.startTime).toBe('2026-11-16T00:00Z')
    expect(next.opponentName).toBe('Houston Rockets')
    expect(next.opponentLogo).toBe('https://a.espncdn.com/i/teamlogos/nba/500/hou.png')
    expect(next.homeAway).toBe('home')
    expect(next.venue).toBe('Capital One Arena')
    expect(next.seasonLabel).toBeNull()
  })

  it('skips the game this email is about, even if ESPN still lists it as upcoming', () => {
    const events = [event('just-played', '2026-11-13T04:00Z'), event('next', '2026-11-16T00:00Z')]
    expect(parseNextGame(events, 'nba', '27', now, 'just-played')?.startTime).toBe('2026-11-16T00:00Z')
  })

  it('reports away games', () => {
    const next = parseNextGame([event('n', '2026-11-16T00:00Z', { homeAway: 'away' })], 'nba', '27', now, 'x')
    expect(next?.homeAway).toBe('away')
  })

  it('labels spring training and playoffs', () => {
    expect(parseNextGame([event('n', '2027-02-20T18:00Z', { seasonType: 1 })], 'mlb', '27', now, 'x')?.seasonLabel)
      .toBe('Spring training')
    expect(parseNextGame([event('n', '2026-11-14T17:00Z', { seasonType: 3 })], 'usa.nwsl', '27', now, 'x')?.seasonLabel)
      .toBe('Playoffs')
  })

  it('returns null when there is nothing ahead', () => {
    expect(parseNextGame([event('old', '2026-11-10T00:00Z', { completed: true })], 'nba', '27', now, 'x')).toBeNull()
    expect(parseNextGame(undefined, 'nba', '27', now, 'x')).toBeNull()
  })

  it('ignores a logo that is not an https URL', () => {
    const e = event('n', '2026-11-16T00:00Z')
    e.competitions[0].competitors[1].team.logos = [{ href: 'javascript:alert(1)' }]
    expect(parseNextGame([e], 'nba', '27', now, 'x')?.opponentLogo).toBeNull()
  })
})
