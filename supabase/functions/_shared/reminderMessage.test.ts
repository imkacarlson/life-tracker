import { describe, expect, it } from 'vitest'

import {
  buildReminderText,
  cleanLineText,
  describeArmedReminders,
  describeLead,
} from './reminderMessage.ts'
import type { DeriveOptions } from './deriveReminders.ts'

const NY = 'America/New_York'
const OPTS: DeriveOptions = {
  todayLocal: '2026-08-09',
  timeZone: NY,
  defaultLeadMinutes: 90,
  quiet: { startHour: 22, endHour: 7 },
}
const ANCHOR = new Date(Date.UTC(2026, 7, 1)) // "August 2026 Tracker"

describe('describeLead', () => {
  it.each([
    [0, 'now'],
    [30, '30 minutes'],
    [1, '1 minute'],
    [90, '90 minutes'],
    [120, '2 hours'],
    [180, '3 hours'],
    [1440, '1 day'],
    [2880, '2 days'],
  ])('%i -> %s', (minutes, expected) => {
    expect(describeLead(minutes)).toBe(expected)
  })
})

describe('cleanLineText', () => {
  it('strips the lead clause and collapses whitespace', () => {
    const line = 'Call venue   8/21 2pm (remind 3 hours before)'
    expect(cleanLineText(line, { start: line.indexOf('remind'), end: line.length - 1 })).toBe(
      'Call venue 8/21 2pm',
    )
  })

  it('leaves the line alone when there is no clause', () => {
    expect(cleanLineText('  Dietician appointment  8/17 8:20am ', null)).toBe(
      'Dietician appointment 8/17 8:20am',
    )
  })

  it('truncates a very long line', () => {
    const cleaned = cleanLineText('x'.repeat(400), null)
    expect(cleaned.length).toBeLessThanOrEqual(200)
    expect(cleaned.endsWith('…')).toBe(true)
  })
})

describe('buildReminderText', () => {
  it('renders header, local time, and the link', () => {
    const text = buildReminderText(
      {
        dueAt: Date.parse('2026-08-17T12:20:00Z'),
        leadMinutes: 90,
        lineText: 'Dietician appointment  8/17 8:20am',
        leadMatch: null,
      },
      NY,
      'https://example.test/#nb=1&block=2',
    )
    expect(text).toBe(
      '⏰ In 90 minutes — Dietician appointment 8/17 8:20am\n\n' +
        'Mon Aug 17 · 8:20 AM\n\n' +
        'https://example.test/#nb=1&block=2',
    )
  })

  it('omits the link line when there is nothing to link to', () => {
    const text = buildReminderText(
      { dueAt: Date.parse('2026-08-17T12:20:00Z'), leadMinutes: 30, lineText: 'Thing', leadMatch: null },
      NY,
      '',
    )
    expect(text.split('\n')).toHaveLength(3)
  })
})

// The bot's confirmation runs the SAME deriver the cron does, so it can never
// promise a reminder the sweep won't send.
describe('describeArmedReminders', () => {
  it('states the armed time and lead for a timed date', () => {
    const line = describeArmedReminders(
      ['call the venue {{date:8/21 2:00 PM}} (remind 3 hours before)'],
      ANCHOR,
      OPTS,
    )
    expect(line).toContain('3 hours before')
    expect(line).toContain('11:00 AM')
    expect(line).toContain('Fri Aug 21')
  })

  it('stays silent for a date with no time', () => {
    expect(describeArmedReminders(['renew pass {{date:6/15}}'], ANCHOR, OPTS)).toBe('')
  })

  it('stays silent when the user asked for no reminder', () => {
    expect(
      describeArmedReminders(['standup {{date:8/13 9:00 AM}} (no reminder)'], ANCHOR, OPTS),
    ).toBe('')
  })

  it('reports one line per armed reminder', () => {
    const text = describeArmedReminders(
      ['dinner {{date:8/17 7:00 PM}}', 'brunch {{date:8/18 10:00 AM}}'],
      ANCHOR,
      OPTS,
    )
    expect(text.split('\n')).toHaveLength(2)
  })
})
