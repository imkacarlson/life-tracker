import { describe, expect, it } from 'vitest'

import { flattenTrackerToText, selectCurrentMonthTracker } from './trackerText.ts'

const now = new Date('2026-05-30T12:00:00Z') // May 2026

describe('selectCurrentMonthTracker', () => {
  const pages = [
    { id: 'a', title: 'April 2026 Tracker', is_tracker_page: true, updated_at: '2026-04-01' },
    { id: 'b', title: 'May 2026 Tracker', is_tracker_page: true, updated_at: '2026-05-01' },
    { id: 'c', title: 'Random notes', is_tracker_page: false, updated_at: '2026-05-29' },
  ]

  it('matches the current month and year by title', () => {
    expect(selectCurrentMonthTracker(pages, now)?.id).toBe('b')
  })

  it('ignores non-tracker pages even if recently updated', () => {
    const result = selectCurrentMonthTracker(pages, now)
    expect(result?.is_tracker_page).toBe(true)
  })

  it('falls back to the most recently updated tracker page when no month match', () => {
    const noMatch = [
      { id: 'x', title: 'January 2026', is_tracker_page: true, updated_at: '2026-01-01' },
      { id: 'y', title: 'February 2026', is_tracker_page: true, updated_at: '2026-02-15' },
    ]
    expect(selectCurrentMonthTracker(noMatch, now)?.id).toBe('y')
  })

  it('returns null when there are no tracker pages', () => {
    expect(selectCurrentMonthTracker([{ id: 'z', is_tracker_page: false }], now)).toBeNull()
    expect(selectCurrentMonthTracker([], now)).toBeNull()
    expect(selectCurrentMonthTracker(null, now)).toBeNull()
  })
})

describe('flattenTrackerToText', () => {
  const text = (value: string, marks?: any[]) => ({ type: 'text', text: value, marks })

  it('preserves strikethrough (does NOT drop completed items)', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [text('Buy ring', [{ type: 'strike' }])] },
      ],
    }
    expect(flattenTrackerToText(doc)).toContain('~~Buy ring~~')
  })

  it('annotates highlight color', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [text('3/15', [{ type: 'highlight', attrs: { color: '#fff2a8' } }])],
        },
      ],
    }
    const out = flattenTrackerToText(doc)
    expect(out).toContain('[3/15]{highlight:#fff2a8}')
  })

  it('wraps plain highlight without a color', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [text('important', [{ type: 'highlight' }])] }],
    }
    expect(flattenTrackerToText(doc)).toContain('[important]')
  })

  it('annotates table cell shading and preserves table structure', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [{ type: 'paragraph', content: [text('Running')] }] },
                {
                  type: 'tableCell',
                  attrs: { backgroundColor: '#c6efce' },
                  content: [{ type: 'paragraph', content: [text('5 mi done')] }],
                },
              ],
            },
          ],
        },
      ],
    }
    const out = flattenTrackerToText(doc)
    expect(out).toContain('| Running |')
    expect(out).toContain('(cell shaded #c6efce)')
    expect(out).toContain('5 mi done')
  })

  it('renders task checkbox state', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [{ type: 'paragraph', content: [text('Pay rent')] }],
            },
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [{ type: 'paragraph', content: [text('Call dentist')] }],
            },
          ],
        },
      ],
    }
    const out = flattenTrackerToText(doc)
    expect(out).toContain('[x] Pay rent')
    expect(out).toContain('[ ] Call dentist')
  })

  it('includes the title when provided', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [text('hi')] }] }
    expect(flattenTrackerToText(doc, 'May 2026 Tracker')).toContain('MAY 2026 TRACKER')
  })

  it('returns empty string for missing content', () => {
    expect(flattenTrackerToText(null)).toBe('')
    expect(flattenTrackerToText(undefined)).toBe('')
  })
})
