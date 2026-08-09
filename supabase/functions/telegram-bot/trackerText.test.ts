import { describe, expect, it } from 'vitest'

import {
  flattenTrackerToText,
  flattenTrackerToTextWithHandles,
  selectCurrentMonthTracker,
} from './trackerText.ts'

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

  it('selects the local month near a UTC month boundary', () => {
    // 2026-06-01T02:00:00Z is June in UTC but still May 31 in America/New_York.
    const boundary = new Date('2026-06-01T02:00:00Z')
    const mayJune = [
      { id: 'may', title: 'May 2026 Tracker', is_tracker_page: true, updated_at: '2026-05-01' },
      { id: 'june', title: 'June 2026 Tracker', is_tracker_page: true, updated_at: '2026-06-01' },
    ]
    // UTC default picks June; the user's local (NY) clock is still May.
    expect(selectCurrentMonthTracker(mayJune, boundary)?.id).toBe('june')
    expect(selectCurrentMonthTracker(mayJune, boundary, 'America/New_York')?.id).toBe('may')
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

describe('flattenTrackerToTextWithHandles', () => {
  const text = (value: string) => ({ type: 'text', text: value })
  const para = (id: string | undefined, value: string) => ({
    type: 'paragraph',
    ...(id ? { attrs: { id } } : {}),
    content: [text(value)],
  })

  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { id: 'uuid-head' }, content: [text('Running')] },
      para('uuid-p1', 'First note'),
      {
        type: 'bulletList',
        attrs: { id: 'uuid-list' },
        content: [
          { type: 'listItem', content: [para('uuid-li1', 'Buy gels')] },
          { type: 'listItem', content: [para('uuid-li2', 'Book hotel')] },
        ],
      },
      para(undefined, 'Unanchored paragraph'),
    ],
  }

  it('allocates b1, b2, … in document order', () => {
    const { text: out, handles } = flattenTrackerToTextWithHandles(doc)
    expect(out).toContain('RUNNING {{b1}}')
    expect(out).toContain('First note {{b2}}')
    expect(out).toContain('- Buy gels {{b3}}')
    expect(out).toContain('- Book hotel {{b4}}')
    expect(handles.get('b1')).toBe('uuid-head')
    expect(handles.get('b2')).toBe('uuid-p1')
    expect(handles.get('b3')).toBe('uuid-li1')
    expect(handles.get('b4')).toBe('uuid-li2')
  })

  it('is deterministic — the same doc yields the same handles', () => {
    const a = flattenTrackerToTextWithHandles(doc)
    const b = flattenTrackerToTextWithHandles(doc)
    expect(b.text).toBe(a.text)
    expect([...b.handles]).toEqual([...a.handles])
  })

  it('gives the list its own standalone handle line (append_to_list anchor)', () => {
    const { text: out, handles } = flattenTrackerToTextWithHandles(doc)
    const listHandle = [...handles].find(([, uuid]) => uuid === 'uuid-list')?.[0]
    expect(listHandle).toBeTruthy()
    expect(out.split('\n')).toContain(`{{${listHandle}}}`)
  })

  it('gives each block exactly one handle', () => {
    const { handles } = flattenTrackerToTextWithHandles(doc)
    const uuids = [...handles.values()]
    expect(new Set(uuids).size).toBe(uuids.length)
    expect(uuids).toEqual(['uuid-head', 'uuid-p1', 'uuid-li1', 'uuid-li2', 'uuid-list'])
  })

  it('emits no marker for blocks without an id', () => {
    const { text: out } = flattenTrackerToTextWithHandles(doc)
    expect(out).toContain('Unanchored paragraph')
    expect(out).not.toMatch(/Unanchored paragraph \{\{/)
  })

  it('emits far fewer characters than raw uuid markers would', () => {
    const { text: out } = flattenTrackerToTextWithHandles(doc)
    expect(out).not.toContain('uuid-p1')
  })

  it('returns an empty map for missing content', () => {
    expect(flattenTrackerToTextWithHandles(null)).toEqual({ text: '', handles: new Map() })
    expect(flattenTrackerToTextWithHandles(undefined).text).toBe('')
  })

  it('includes the title when provided', () => {
    expect(flattenTrackerToTextWithHandles(doc, 'May 2026 Tracker').text).toContain(
      'MAY 2026 TRACKER',
    )
  })
})
