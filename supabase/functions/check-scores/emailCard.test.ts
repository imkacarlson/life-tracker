import { describe, expect, it } from 'vitest'

import { type CardData, buildCardHtml, formatGameTime, ordinal } from './emailCard.ts'
import type { GameResult, Team } from './espn.ts'
import type { Standings } from './teamContext.ts'

const WIZARDS = {
  id: 'team-wiz',
  name: 'wizards',
  display_name: 'Washington Wizards',
  sport: 'basketball',
  league: 'nba',
  espn_team_id: '27',
  emoji_win: '🏀🏆',
  emoji_loss: '🏀❌',
  emoji_tie: '🏀🤝',
  next_poll_at: null,
} satisfies Team

// The real 2026-11-12 game: Wizards lose 101-114 at Indiana.
const GAME: GameResult = {
  espnGameId: '401',
  gameDate: '2026-11-13',
  teamScore: 101,
  opponentName: 'Indiana Pacers',
  opponentScore: 114,
  result: 'loss',
  homeAway: 'away',
  rawData: {
    date: '2026-11-13T00:00Z',
    competitions: [{
      competitors: [
        { homeAway: 'home', team: { id: '11', displayName: 'Indiana Pacers', color: '0c2340' }, records: [{ summary: '4-8' }] },
        { homeAway: 'away', team: { id: '27', displayName: 'Washington Wizards', color: 'e31837' }, records: [{ summary: '4-8' }] },
      ],
    }],
  },
}

const STANDINGS: Standings = {
  groupLabel: 'East',
  groupName: 'Eastern Conference',
  legend: '1–6 in · 7–10 play-in',
  extraLabel: 'GB',
  rows: [
    { rank: 9, name: 'Bulls', record: '5–6', extra: '4', isUs: false, isLastOpponent: false },
    { rank: 10, name: 'Wizards', record: '4–8', extra: '5', isUs: true, isLastOpponent: false },
    { rank: 11, name: 'Pacers', record: '4–8', extra: '5', isUs: false, isLastOpponent: true },
  ],
  cutLines: [{ afterRank: 10, label: 'Out', kind: 'out' }],
  ourRank: 10,
  streak: 'L2',
  gamesBack: '5',
  points: null,
}

const full = (): CardData => ({
  insight: { playoff_odds_pct: 31, news: 'Anthony Davis put up 44 & 13 in his return.' },
  previousOddsPct: 38,
  context: {
    standings: STANDINGS,
    nextGame: {
      startTime: '2026-11-16T00:00Z',
      timeValid: true,
      homeAway: 'home',
      opponentName: 'Houston Rockets',
      opponentLogo: 'https://a.espncdn.com/i/teamlogos/nba/500/hou.png',
      venue: 'Capital One Arena',
      seasonLabel: null,
    },
  },
})

const empty = (): CardData => ({ insight: null, previousOddsPct: null, context: { standings: null, nextGame: null } })

describe('buildCardHtml', () => {
  it('renders every section when all data is present', () => {
    const html = buildCardHtml(WIZARDS, GAME, full())
    expect(html).toContain('Final · Away · Nov 12')
    expect(html).toContain('Loss')
    expect(html).toContain('4–8') // record tile, from the scoreboard
    expect(html).toContain('10th')
    expect(html).toContain('31%')
    expect(html).toContain('▼ 7 pts')
    expect(html).toContain('Sun, Nov 15 · 7:00 PM')
    expect(html).toContain('vs Houston Rockets · Capital One Arena')
    expect(html).toContain('src="https://a.espncdn.com/i/teamlogos/nba/500/hou.png"')
    expect(html).toContain('Home')
    expect(html).toContain('Eastern Conference')
    expect(html).toContain('last game')
  })

  it('uses the team color for the score band', () => {
    expect(buildCardHtml(WIZARDS, GAME, full())).toContain('background:#e31837')
  })

  it('draws the result pill white so it reads on a red band', () => {
    // The 2026-11-12 test email: a solid red Loss pill on the Wizards' red band.
    const html = buildCardHtml(WIZARDS, GAME, full())
    expect(html).toMatch(/background:#ffffff;color:#d64545;[^>]*>Loss</)
  })

  it('escapes Gemini text', () => {
    const html = buildCardHtml(WIZARDS, GAME, full())
    expect(html).toContain('44 &amp; 13')
    const data = full()
    data.insight!.news = '<script>alert(1)</script>'
    expect(buildCardHtml(WIZARDS, GAME, data)).not.toContain('<script>')
  })

  it('still renders the score when everything else is missing', () => {
    const html = buildCardHtml(WIZARDS, GAME, empty())
    expect(html).toContain('101')
    expect(html).toContain('114')
    expect(html).toContain('Washington Wizards')
    expect(html).not.toContain('Next')
    expect(html).not.toContain('News')
    expect(html).not.toContain('Playoffs')
  })

  it('falls back to games back when there are no odds', () => {
    const data = full()
    data.insight = { playoff_odds_pct: null, news: 'x' }
    const html = buildCardHtml(WIZARDS, GAME, data)
    expect(html).not.toContain('Playoffs')
    expect(html).toContain('Games back')
  })

  it('shows no change arrow without a previous number', () => {
    const data = full()
    data.previousOddsPct = null
    const html = buildCardHtml(WIZARDS, GAME, data)
    expect(html).not.toContain('▼')
    expect(html).not.toContain('▲')
  })

  it('shows the streak only when standings already include this game', () => {
    expect(buildCardHtml(WIZARDS, GAME, full())).toContain('L2')

    const stale = full()
    stale.context.standings = {
      ...STANDINGS,
      rows: STANDINGS.rows.map((r) => (r.isUs ? { ...r, record: '4–7' } : r)),
    }
    const html = buildCardHtml(WIZARDS, GAME, stale)
    expect(html).not.toContain('L2')
    expect(html).toContain('Standings may not include this game yet.')
  })

  it('marks away games', () => {
    const data = full()
    data.context.nextGame!.homeAway = 'away'
    const html = buildCardHtml(WIZARDS, GAME, data)
    expect(html).toContain('Away')
    expect(html).toContain('at Houston Rockets')
  })

  it('never uses tags Gmail strips', () => {
    const html = buildCardHtml(WIZARDS, GAME, full())
    expect(html).not.toMatch(/<svg|<script|<style/i)
  })
})

describe('helpers', () => {
  it('ordinal', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 112].map(ordinal)).toEqual(
      ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '112th'],
    )
  })

  it('formats game times in Eastern time', () => {
    expect(formatGameTime('2026-11-16T00:00Z', true)).toBe('Sun, Nov 15 · 7:00 PM')
    expect(formatGameTime('2026-11-14T20:30Z', false)).toBe('Sat, Nov 14 · Time TBD')
  })
})
