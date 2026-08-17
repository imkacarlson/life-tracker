import { describe, expect, it } from 'vitest'

import {
  buildDoneConfirmation,
  buildReminderText,
  buildSnoozeConfirmation,
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
  const reminder = {
    dueAt: Date.parse('2026-08-17T12:20:00Z'),
    leadMinutes: 90,
    lineText: 'Dietician appointment  8/17 8:20am',
    leadMatch: null,
  }
  const link = 'https://example.test/#nb=1&sec=2&block=3'

  it('renders the link as tappable "Open in tracker" text', () => {
    expect(buildReminderText(reminder, NY, link)).toBe(
      '⏰ In 90 minutes — Dietician appointment 8/17 8:20am\n\n' +
        'Mon Aug 17 · 8:20 AM\n\n' +
        '<a href="https://example.test/#nb=1&amp;sec=2&amp;block=3">Open in tracker</a>',
    )
  })

  it('escapes HTML-significant characters in the user\'s own line text', () => {
    const spicy = { ...reminder, lineText: 'Email <sam@x.com> re: A&B  8/17 8:20am' }
    const text = buildReminderText(spicy, NY, '')
    expect(text).toContain('Email &lt;sam@x.com&gt; re: A&amp;B')
    expect(text).not.toContain('<sam@')
  })

  it('falls back to a bare URL in plain mode', () => {
    expect(buildReminderText(reminder, NY, link, 'plain')).toBe(
      '⏰ In 90 minutes — Dietician appointment 8/17 8:20am\n\n' +
        'Mon Aug 17 · 8:20 AM\n\n' +
        link,
    )
  })

  it('leaves the plain build unescaped so Telegram auto-links it', () => {
    const spicy = { ...reminder, lineText: 'Email <sam@x.com> re: A&B' }
    expect(buildReminderText(spicy, NY, link, 'plain')).toContain('Email <sam@x.com> re: A&B')
  })

  it('omits the link line when there is nothing to link to', () => {
    expect(buildReminderText(reminder, NY, '').split('\n')).toHaveLength(3)
    expect(buildReminderText(reminder, NY, '', 'plain').split('\n')).toHaveLength(3)
  })
})

// Intent can now be AI-inferred, so every action states what it matched — that
// echo is how a mis-targeted reminder becomes visible immediately.
describe('buildSnoozeConfirmation', () => {
  const FIRE_AT = Date.parse('2026-08-17T19:45:00Z') // 3:45 PM in New York

  it('states the delay, quotes the line, and resolves the clock time', () => {
    expect(
      buildSnoozeConfirmation({
        lineText: 'Call the wedding venue',
        minutes: 30,
        fireAt: FIRE_AT,
        timeZone: NY,
      }),
    ).toBe(
      '⏰ Snoozed 30 minutes — "Call the wedding venue" — ' +
        "I'll ping you Mon Aug 17 at 3:45 PM.",
    )
  })

  it('collapses whitespace in the quoted line', () => {
    expect(
      buildSnoozeConfirmation({
        lineText: '  Call the   venue  ',
        minutes: 60,
        fireAt: FIRE_AT,
        timeZone: NY,
      }),
    ).toContain('— "Call the venue" —')
  })

  it('drops the quote when the reminder carries no line text', () => {
    const text = buildSnoozeConfirmation({
      lineText: null,
      minutes: 120,
      fireAt: FIRE_AT,
      timeZone: NY,
    })
    expect(text).toBe("⏰ Snoozed 2 hours — I'll ping you Mon Aug 17 at 3:45 PM.")
    expect(text).not.toContain('""')
  })
})

describe('buildDoneConfirmation', () => {
  it('quotes the line and links to it', () => {
    expect(buildDoneConfirmation('Call the venue', 'https://example.test/#block=3')).toBe(
      '✅ Crossed off:\n\n"Call the venue"\n\n[Open in tracker](https://example.test/#block=3)',
    )
  })

  it('omits empty parts rather than emitting a bare quote or link', () => {
    expect(buildDoneConfirmation('', '')).toBe('✅ Crossed off:')
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
