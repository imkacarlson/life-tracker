import { describe, expect, it } from 'vitest'

import {
  LIVE_POLL_MINUTES,
  MAX_POLL_MINUTES,
  MIDGAME_POLL_MINUTES,
  STALLED_POLL_MINUTES,
  type ScoreboardGame,
  estimateRemainingMinutes,
  findStaleGames,
  nextPollDelayMinutes,
  parseClockMinutes,
} from './pollSchedule.ts'

const NOW = new Date('2026-08-29T20:00:00Z')

// Hand-authored, shape-only fixtures — deliberately NOT captured ESPN payloads.
const game = (overrides: Partial<ScoreboardGame> = {}): ScoreboardGame => ({
  id: 'g1',
  startTime: '2026-08-29T19:00:00Z',
  state: 'in',
  completed: false,
  period: 1,
  displayClock: null,
  statusName: 'STATUS_IN_PROGRESS',
  ...overrides,
})

describe('parseClockMinutes', () => {
  it('reads mm:ss', () => {
    expect(parseClockMinutes('12:00')).toBe(12)
    expect(parseClockMinutes('0:30')).toBe(0.5)
  })

  it('returns null for absent or non-clock text', () => {
    expect(parseClockMinutes(null)).toBeNull()
    expect(parseClockMinutes('')).toBeNull()
    expect(parseClockMinutes('-')).toBeNull()
    expect(parseClockMinutes('End of 3rd')).toBeNull()
  })
})

describe('estimateRemainingMinutes', () => {
  it('estimates baseball by innings left', () => {
    expect(estimateRemainingMinutes(game({ period: 2 }), 'mlb')).toBe(140)
    expect(estimateRemainingMinutes(game({ period: 8 }), 'mlb')).toBe(20)
  })

  it('returns zero for extra innings — it could end at any moment', () => {
    expect(estimateRemainingMinutes(game({ period: 11 }), 'mlb')).toBe(0)
  })

  it('estimates clock sports from period plus displayClock', () => {
    // NBA 1st quarter, 10:00 left: 10 + 3*12 = 46 game-min * 2.2
    expect(estimateRemainingMinutes(game({ period: 1, displayClock: '10:00' }), 'nba')).toBeCloseTo(
      101.2,
      1,
    )
    // NBA 4th quarter, 2:00 left: 2 game-min * 2.2
    expect(estimateRemainingMinutes(game({ period: 4, displayClock: '2:00' }), 'nba')).toBeCloseTo(
      4.4,
      1,
    )
  })

  it('knows the men\'s college game is two halves and the women\'s is four quarters', () => {
    const secondHalf = game({ period: 2, displayClock: '5:00' })
    expect(estimateRemainingMinutes(secondHalf, 'mens-college-basketball')).toBeCloseTo(9, 1)
    // Same period number is only halfway through the women's game.
    expect(estimateRemainingMinutes(secondHalf, 'womens-college-basketball')).toBeCloseTo(45, 1)
  })

  it('handles soccer\'s count-up clock', () => {
    expect(estimateRemainingMinutes(game({ period: 2, displayClock: '80:00' }), 'usa.nwsl')).toBeCloseTo(
      11.5,
      1,
    )
  })

  it('falls back to a full period when the clock is missing', () => {
    expect(estimateRemainingMinutes(game({ period: 3, displayClock: null }), 'nhl')).toBeCloseTo(40, 1)
  })
})

describe('nextPollDelayMinutes', () => {
  it('sleeps a full day when nothing is scheduled', () => {
    expect(nextPollDelayMinutes([], 'mlb', NOW)).toBe(MAX_POLL_MINUTES)
  })

  it('sleeps a full day when every game is already final', () => {
    const done = game({ state: 'post', completed: true, statusName: 'STATUS_FINAL' })
    expect(nextPollDelayMinutes([done], 'mlb', NOW)).toBe(MAX_POLL_MINUTES)
  })

  it('sleeps until the start of a scheduled game', () => {
    const upcoming = game({
      state: 'pre',
      statusName: 'STATUS_SCHEDULED',
      startTime: '2026-08-29T23:05:00Z', // 3h05m out
    })
    expect(nextPollDelayMinutes([upcoming], 'mlb', NOW)).toBe(185)
  })

  it('picks the earliest of several scheduled games', () => {
    const games = [
      game({ id: 'a', state: 'pre', startTime: '2026-08-30T02:00:00Z' }),
      game({ id: 'b', state: 'pre', startTime: '2026-08-29T22:00:00Z' }),
    ]
    expect(nextPollDelayMinutes(games, 'mlb', NOW)).toBe(120)
  })

  it('never sleeps less than the live cadence for a start time already passed', () => {
    const pending = game({ state: 'pre', startTime: '2026-08-29T19:30:00Z' })
    expect(nextPollDelayMinutes([pending], 'mlb', NOW)).toBe(LIVE_POLL_MINUTES)
  })

  it('checks back in an hour early in a game', () => {
    const early = game({ period: 1, displayClock: '10:00' })
    expect(nextPollDelayMinutes([early], 'nba', NOW)).toBe(MIDGAME_POLL_MINUTES)
  })

  it('polls every 15 minutes once the end is in sight', () => {
    const late = game({ period: 4, displayClock: '3:00' })
    expect(nextPollDelayMinutes([late], 'nba', NOW)).toBe(LIVE_POLL_MINUTES)
  })

  it('backs off hard on a delay rather than spinning', () => {
    const delayed = game({ statusName: 'STATUS_DELAYED' })
    expect(nextPollDelayMinutes([delayed], 'mlb', NOW)).toBe(STALLED_POLL_MINUTES)
  })

  it('ignores a postponed game when choosing the next scheduled start', () => {
    const games = [
      game({ id: 'a', state: 'pre', statusName: 'STATUS_POSTPONED', startTime: '2026-08-29T20:30:00Z' }),
      game({ id: 'b', state: 'pre', statusName: 'STATUS_SCHEDULED', startTime: '2026-08-29T23:00:00Z' }),
    ]
    expect(nextPollDelayMinutes(games, 'mlb', NOW)).toBe(180)
  })

  it('follows the game closest to finishing when two are live', () => {
    const games = [
      game({ id: 'a', period: 1, displayClock: '11:00' }),
      game({ id: 'b', period: 4, displayClock: '1:00' }),
    ]
    expect(nextPollDelayMinutes(games, 'nba', NOW)).toBe(LIVE_POLL_MINUTES)
  })
})

describe('findStaleGames — the Aug 5 detector', () => {
  const expected = [
    { espn_game_id: '401816681', start_time: '2026-08-29T02:00:00Z' }, // 18h ago
    { espn_game_id: '401816682', start_time: '2026-08-29T19:30:00Z' }, // 30m ago
  ]

  it('flags a long-finished game with no recorded result', () => {
    expect(findStaleGames(expected, [], NOW).map((g) => g.espn_game_id)).toEqual(['401816681'])
  })

  it('stays quiet once the result is recorded', () => {
    expect(findStaleGames(expected, ['401816681'], NOW)).toEqual([])
  })

  it('does not flag a game that is probably still being played', () => {
    const recent = [{ espn_game_id: 'x', start_time: '2026-08-29T17:00:00Z' }]
    expect(findStaleGames(recent, [], NOW)).toEqual([])
  })

  it('ignores an unparseable start time rather than alerting forever', () => {
    expect(findStaleGames([{ espn_game_id: 'x', start_time: 'soon' }], [], NOW)).toEqual([])
  })
})
