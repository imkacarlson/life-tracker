import { describe, expect, it } from 'vitest'

import {
  countOrphanedTimedHighlights,
  deferPastQuietHours,
  deriveReminders,
  mergeAdjacentHighlights,
  type DeriveOptions,
} from './deriveReminders.ts'

const NY = 'America/New_York'
const CYAN = '#67e8f9'

const OPTS: DeriveOptions = {
  todayLocal: '2026-08-09',
  timeZone: NY,
  defaultLeadMinutes: 90,
  quiet: { startHour: 22, endHour: 7 },
}

let idCounter = 0
const nextId = () => `block-${++idCounter}`

/** A paragraph whose content is [plain, highlighted, plain, …] by alternation. */
const para = (runs: Array<[string, boolean]>, id = nextId()) => ({
  type: 'paragraph',
  attrs: { id },
  content: runs.map(([text, highlighted]) => ({
    type: 'text',
    text,
    ...(highlighted ? { marks: [{ type: 'highlight', attrs: { color: CYAN } }] } : {}),
  })),
})

const doc = (...blocks: unknown[]) => ({ type: 'doc', content: blocks })

const page = (...blocks: unknown[]) => ({
  id: 'page-1',
  title: 'August 2026 Tracker',
  content: doc(...blocks),
})

const derive = (content: unknown, opts: Partial<DeriveOptions> = {}) =>
  deriveReminders([{ id: 'page-1', title: 'August 2026 Tracker', content }], { ...OPTS, ...opts })

const iso = (ts: number) => new Date(ts).toISOString()

// ---------------------------------------------------------------------------
// ⭐ The #1 regression to guard: the user's 573 existing date-only highlights.
// ---------------------------------------------------------------------------
describe('date-only highlights never arm a reminder', () => {
  const dateOnly = [
    '8/17',
    'EOD 4/5',
    'by EOD 2/15',
    '2/22 weekend',
    '12/28/30',
    '3/2/27',
    '10/25/27',
    '8/17 2026',
    '8/17 5-10 miles',
  ]

  it.each(dateOnly)('%j -> zero reminders', (text) => {
    expect(derive(doc(para([['Some task ', false], [text, true]])))).toEqual([])
  })
})

describe('a clock time inside the highlight arms a reminder', () => {
  it('uses the 90-minute default lead', () => {
    const [reminder, ...rest] = derive(
      doc(para([['Dietician appointment  ', false], ['8/17 8:20am', true]])),
    )
    expect(rest).toEqual([])
    expect(iso(reminder.dueAt)).toBe('2026-08-17T12:20:00.000Z') // 8:20 AM EDT
    expect(reminder.leadMinutes).toBe(90)
    // Raw fire time is 6:50 AM, which sits inside the 22:00-07:00 quiet window,
    // so it defers to the 7:00 boundary — still an hour and change before the
    // appointment. The quiet rule wins over the raw lead arithmetic.
    expect(reminder.quietDeferred).toBe(true)
    expect(iso(reminder.fireAt)).toBe('2026-08-17T11:00:00.000Z') // 7:00 AM EDT
    expect(reminder.blockId).toBeTruthy()
    expect(reminder.pageId).toBe('page-1')
  })

  it('honours a lead-time phrase in the plain text', () => {
    const [reminder] = derive(
      doc(para([['Call venue ', false], ['8/21 2pm', true], [' (remind 3 hours before)', false]])),
    )
    expect(reminder.leadMinutes).toBe(180)
    expect(iso(reminder.fireAt)).toBe('2026-08-21T15:00:00.000Z') // 11:00 AM EDT
  })

  it('stays silent when the line says not to remind', () => {
    expect(
      derive(doc(para([['Standup ', false], ['8/13 9am', true], [' — no reminder', false]]))),
    ).toEqual([])
  })

  it('ignores struck-through lines', () => {
    const struck = {
      type: 'paragraph',
      attrs: { id: nextId() },
      content: [
        {
          type: 'text',
          text: '8/17 8:20am',
          marks: [{ type: 'highlight', attrs: { color: CYAN } }, { type: 'strike' }],
        },
      ],
    }
    expect(derive(doc(struck))).toEqual([])
  })

  it('ignores a time that sits OUTSIDE the highlight', () => {
    expect(derive(doc(para([['8/17', true], [' 8:20am', false]])))).toEqual([])
  })

  it('emits one reminder per timed date on a line', () => {
    const reminders = derive(
      doc(para([['Dinner ', false], ['8/17 7pm', true], [', brunch ', false], ['8/18 10am', true]])),
    )
    expect(reminders).toHaveLength(2)
    expect(new Set(reminders.map((r) => r.dedupKey)).size).toBe(2)
  })

  it('emits one reminder per lead when several are requested', () => {
    const reminders = derive(
      doc(para([['Flight ', false], ['9/26 6:15am', true], [' — remind 1 day and 2h before', false]])),
    )
    expect(reminders.map((r) => r.leadMinutes)).toEqual([1440, 120])
  })
})

describe('highlight pairing', () => {
  it('pairs across an unhighlighted space', () => {
    expect(derive(doc(para([['8/17', true], [' ', false], ['8:20am', true]])))).toHaveLength(1)
  })

  it('does NOT pair across a hard break', () => {
    const block = {
      type: 'paragraph',
      attrs: { id: nextId() },
      content: [
        { type: 'text', text: '8/17', marks: [{ type: 'highlight', attrs: { color: CYAN } }] },
        { type: 'hardBreak' },
        { type: 'text', text: '8:20am', marks: [{ type: 'highlight', attrs: { color: CYAN } }] },
      ],
    }
    expect(derive(doc(block))).toEqual([])
  })

  it('scopes the lead phrase to its own visual line', () => {
    // The "remind 1 day before" sits on line 2; the date is on line 1.
    const block = {
      type: 'paragraph',
      attrs: { id: nextId() },
      content: [
        { type: 'text', text: '8/17 8:20am', marks: [{ type: 'highlight', attrs: { color: CYAN } }] },
        { type: 'hardBreak' },
        { type: 'text', text: 'other thing — remind 1 day before' },
      ],
    }
    expect(derive(doc(block))[0].leadMinutes).toBe(90) // the default, not 1440
  })

  it('mergeAdjacentHighlights folds a chain but respects newlines', () => {
    expect(
      mergeAdjacentHighlights([
        { text: 'a', highlighted: true },
        { text: ' ', highlighted: false },
        { text: 'b', highlighted: true },
      ]),
    ).toEqual([{ text: 'a b', highlighted: true }])

    expect(
      mergeAdjacentHighlights([
        { text: 'a', highlighted: true },
        { text: '\n', highlighted: false },
        { text: 'b', highlighted: true },
      ]),
    ).toHaveLength(3)
  })
})

describe('the year ladder', () => {
  it('rolls a bare date past the tracker month into the next year', () => {
    // "January 2027 Tracker" doesn't exist yet; on the August 2026 page a bare
    // 1/5 means the NEXT January.
    const [reminder] = derive(doc(para([['Renew ', false], ['1/5 9am', true]])))
    expect(iso(reminder.dueAt).slice(0, 10)).toBe('2027-01-05')
  })

  it('respects an explicit slash-year', () => {
    const [reminder] = derive(doc(para([['Expires ', false], ['3/2/27 9am', true]])))
    expect(iso(reminder.dueAt).slice(0, 10)).toBe('2027-03-02')
  })
})

describe('quiet hours defer rather than drop', () => {
  it('pushes an 03:00 fire time to 07:00 local', () => {
    // Event at 9am, 6h lead -> 3am. Deferred to 7am, still before the event.
    const [reminder] = derive(
      doc(para([['Thing ', false], ['8/17 9:00am', true], [' — remind 6 hours before', false]])),
    )
    expect(reminder.quietDeferred).toBe(true)
    expect(iso(reminder.fireAt)).toBe('2026-08-17T11:00:00.000Z') // 7:00 AM EDT
  })

  it('does NOT defer past the event itself', () => {
    // 6am flight, 90-min lead -> 4:30am. Deferring to 7am would be after takeoff.
    const [reminder] = derive(doc(para([['Flight ', false], ['9/26 6:15am', true]])))
    expect(reminder.quietDeferred).toBe(false)
    expect(iso(reminder.fireAt)).toBe('2026-09-26T08:45:00.000Z') // 4:45 AM EDT
  })

  it('leaves a daytime fire time alone', () => {
    const dueAt = Date.parse('2026-08-17T20:00:00Z')
    const fireAt = Date.parse('2026-08-17T18:00:00Z') // 2pm EDT
    expect(deferPastQuietHours(fireAt, dueAt, NY, { startHour: 22, endHour: 7 })).toEqual({
      fireAt,
      deferred: false,
    })
  })
})

// ---------------------------------------------------------------------------
// ⭐ Part 1's payoff: dates inside multi-column tables used to be unreachable.
// ---------------------------------------------------------------------------
describe('multi-column table rows', () => {
  const cell = (runs: Array<[string, boolean]>) => ({
    type: 'tableCell',
    content: [para(runs)],
  })

  const rewardsTable = {
    type: 'table',
    content: [
      {
        type: 'tableRow',
        content: [
          { type: 'tableHeader', content: [para([['Reward', false]])] },
          { type: 'tableHeader', content: [para([['Use-By Date', false]])] },
          { type: 'tableHeader', content: [para([['Notes', false]])] },
        ],
      },
      {
        type: 'tableRow',
        content: [
          cell([['Chase points', false]]),
          cell([['8/17 8:20am', true]]),
          cell([['book the flight', false]]),
        ],
      },
    ],
  }

  it('derives a reminder from a timed date in a table cell', () => {
    const reminders = derive(doc(rewardsTable))
    expect(reminders).toHaveLength(1)
    expect(reminders[0].blockId).toBeTruthy()
    // The whole row is the addressable unit, so the Notes cell is in the text.
    expect(reminders[0].lineText).toContain('Chase points')
    expect(reminders[0].lineText).toContain('book the flight')
  })

  it('does not derive anything from the header row', () => {
    const headerOnly = {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [para([['8/17 8:20am', true]])] },
            { type: 'tableHeader', content: [para([['x', false]])] },
          ],
        },
      ],
    }
    expect(derive(doc(headerOnly))).toEqual([])
  })
})

describe('countOrphanedTimedHighlights', () => {
  it('is zero when every timed highlight was reachable', () => {
    const content = doc(para([['Appt ', false], ['8/17 8:20am', true]]))
    const reminders = derive(content)
    expect(countOrphanedTimedHighlights([page(...(content.content as never[]))], reminders.length)).toBe(0)
  })

  it('reports a timed highlight that produced no reminder', () => {
    const content = doc(para([['Appt ', false], ['8/17 8:20am', true]]))
    expect(countOrphanedTimedHighlights([{ id: 'p', title: 'August 2026 Tracker', content }], 0)).toBe(1)
  })
})

describe('dedup keys', () => {
  it('changes when the time changes but not when the wording does', () => {
    const first = derive(doc(para([['Appt ', false], ['8/17 8:20am', true]], 'fixed-id')))
    const reworded = derive(doc(para([['Doctor appt ', false], ['8/17 8:20am', true]], 'fixed-id')))
    const retimed = derive(doc(para([['Appt ', false], ['8/17 9:20am', true]], 'fixed-id')))

    expect(reworded[0].dedupKey).toBe(first[0].dedupKey)
    expect(retimed[0].dedupKey).not.toBe(first[0].dedupKey)
  })

  it('changes when the lead changes', () => {
    const base = derive(doc(para([['Appt ', false], ['8/17 8:20am', true]], 'fixed-id')))
    const led = derive(
      doc(para([['Appt ', false], ['8/17 8:20am', true], [' (remind 30 min before)', false]], 'fixed-id')),
    )
    expect(led[0].dedupKey).not.toBe(base[0].dedupKey)
  })
})
