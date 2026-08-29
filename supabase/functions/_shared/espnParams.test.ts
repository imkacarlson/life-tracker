import { describe, expect, it } from 'vitest'

import {
  buildScoreboardUrl,
  buildScoreboardUrls,
  easternDateString,
  easternLookbackDates,
  easternMonth,
  isLeagueInSeason,
} from './espnParams.ts'

describe('easternDateString — the "dates= is Eastern, not UTC" bug', () => {
  it('uses the Eastern calendar day, not the UTC one, for a late-night game', () => {
    // 2026-09-04T00:30:00Z is 8:30pm ET on Sep 3. Querying 20260904 (the UTC
    // date) is exactly what made these games invisible.
    expect(easternDateString(new Date('2026-09-04T00:30:00Z'))).toBe('20260903')
  })

  it('handles the daylight-saving offset (EDT, UTC-4)', () => {
    expect(easternDateString(new Date('2026-07-15T03:59:00Z'))).toBe('20260714')
    expect(easternDateString(new Date('2026-07-15T04:01:00Z'))).toBe('20260715')
  })

  it('handles the standard-time offset (EST, UTC-5)', () => {
    expect(easternDateString(new Date('2026-01-15T04:59:00Z'))).toBe('20260114')
    expect(easternDateString(new Date('2026-01-15T05:01:00Z'))).toBe('20260115')
  })

  it('zero-pads month and day', () => {
    expect(easternDateString(new Date('2026-03-05T18:00:00Z'))).toBe('20260305')
  })
})

describe('easternLookbackDates', () => {
  it('returns today and yesterday in Eastern, newest first', () => {
    expect(easternLookbackDates(new Date('2026-09-04T18:00:00Z'))).toEqual([
      '20260904',
      '20260903',
    ])
  })

  it('crosses a month boundary', () => {
    expect(easternLookbackDates(new Date('2026-10-01T15:00:00Z'))).toEqual([
      '20261001',
      '20260930',
    ])
  })

  it('crosses a year boundary', () => {
    expect(easternLookbackDates(new Date('2026-01-01T15:00:00Z'))).toEqual([
      '20260101',
      '20251231',
    ])
  })
})

describe('buildScoreboardUrl — the "college needs groups=" bug', () => {
  it('omits groups for pro leagues', () => {
    expect(buildScoreboardUrl('baseball', 'mlb', '20260904')).toBe(
      'https://site.web.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=20260904',
    )
  })

  it('adds the Big Ten group for college football', () => {
    expect(buildScoreboardUrl('football', 'college-football', '20260904')).toBe(
      'https://site.web.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20260904&groups=5',
    )
  })

  it('adds the Big Ten group for both college basketball leagues', () => {
    expect(buildScoreboardUrl('basketball', 'mens-college-basketball', '20260201')).toContain(
      '&groups=7',
    )
    expect(buildScoreboardUrl('basketball', 'womens-college-basketball', '20260201')).toContain(
      '&groups=7',
    )
  })

  it('never sends a limit param', () => {
    // limit=900 perversely REDUCED college football results. Guard against
    // anyone "optimizing" it back in.
    expect(buildScoreboardUrl('football', 'college-football', '20260904')).not.toContain('limit')
  })

  it('uses the site.web host, not the 403-ing site.api host', () => {
    const url = buildScoreboardUrl('hockey', 'nhl', '20260115')
    expect(url.startsWith('https://site.web.api.espn.com/')).toBe(true)
  })
})

describe('buildScoreboardUrls', () => {
  it('covers both Eastern lookback dates', () => {
    const urls = buildScoreboardUrls('baseball', 'mlb', new Date('2026-09-04T18:00:00Z'))
    expect(urls).toHaveLength(2)
    expect(urls[0]).toContain('dates=20260904')
    expect(urls[1]).toContain('dates=20260903')
  })
})

describe('season windows', () => {
  it('reads the Eastern month', () => {
    expect(easternMonth(new Date('2026-03-01T04:00:00Z'))).toBe(2) // still Feb 28 in ET
  })

  it('skips leagues that cannot be playing', () => {
    const july = new Date('2026-07-15T18:00:00Z')
    expect(isLeagueInSeason('mlb', july)).toBe(true)
    expect(isLeagueInSeason('nba', july)).toBe(false)
    expect(isLeagueInSeason('college-football', july)).toBe(false)
  })

  it('keeps winter leagues in season across the new year', () => {
    const january = new Date('2026-01-15T18:00:00Z')
    expect(isLeagueInSeason('nba', january)).toBe(true)
    expect(isLeagueInSeason('nhl', january)).toBe(true)
    expect(isLeagueInSeason('mens-college-basketball', january)).toBe(true)
    expect(isLeagueInSeason('mlb', january)).toBe(false)
  })

  it('never skips an unknown league', () => {
    expect(isLeagueInSeason('soccer.made-up', new Date('2026-07-15T18:00:00Z'))).toBe(true)
  })
})
