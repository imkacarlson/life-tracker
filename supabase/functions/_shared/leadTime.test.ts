import { describe, expect, it } from 'vitest'

import { DEFAULT_LEAD_MINUTES, parseLeadTimes } from './leadTime.ts'

const leads = (text: string) => parseLeadTimes(text).minutes

describe('parseLeadTimes — accepted clauses', () => {
  const cases: Array<[string, number[]]> = [
    ['Flight to Denver 9/26 6:15am — text me 1 day before', [1440]],
    ['Call venue 8/21 2pm (remind 3 hours before)', [180]],
    ['ping me 30 min before', [30]],
    ['alert 45 minutes before', [45]],
    ['nudge me 2h before', [120]],
    ['warn me 1 week before', [10080]],
    ['an hour before', [60]], // terminal clause, no trigger needed
    ['half an hour before', [30]],
    ['1 day before', [1440]],
    ['remind 1 hour 30 min before', [90]], // adjacent quantities sum
    ['remind 1 day and 2h before', [1440, 120]], // a connector splits them
    ['text me 15 minutes before.', [15]],
    ['notify me two days before', [2880]],
  ]

  it.each(cases)('%j -> %j', (text, expected) => {
    expect(leads(text)).toEqual(expected)
  })
})

describe('parseLeadTimes — suppression wins over everything', () => {
  const suppressing = [
    'Standup 8/13 9am — no reminder',
    'no reminders',
    'no alerts please',
    "don't remind me",
    'do not text me',
    // Even alongside a perfectly good lead clause.
    'remind 2 hours before — actually no reminder',
  ]

  it.each(suppressing)('%j', (text) => {
    const result = parseLeadTimes(text)
    expect(result.suppressed).toBe(true)
    expect(result.minutes).toEqual([])
  })
})

// The real false-positive class. Ordinary prose must never silently rewrite its
// own lead time — these fall through to the caller's default.
describe('parseLeadTimes — prose is not an instruction', () => {
  const noClause = [
    'finish 3 days before the wedding 8/17 7pm',
    '20 mi before work',
    'run 5 miles before breakfast',
    'Dietician appointment 8/17 8:20am',
    '',
  ]

  it.each(noClause)('%j -> no clause', (text) => {
    const result = parseLeadTimes(text)
    expect(result.suppressed).toBe(false)
    expect(result.minutes).toEqual([])
    expect(result.match).toBeNull()
  })
})

it('caps runaway clauses at three leads', () => {
  expect(leads('remind 1 day and 2 hours and 30 min and 10 min before').length).toBeLessThanOrEqual(3)
})

it('reports the clause range so the display text can strip it', () => {
  const text = 'Call venue (remind 3 hours before)'
  const result = parseLeadTimes(text)
  expect(text.slice(result.match!.start, result.match!.end)).toBe('remind 3 hours before')
})

it('exposes the agreed 90-minute default', () => {
  expect(DEFAULT_LEAD_MINUTES).toBe(90)
})
