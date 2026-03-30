import { describe, expect, it } from 'vitest'

import { filterCandidatesForDaily, mapTasksFromCids } from './dailyHelpers.ts'

describe('filterCandidatesForDaily', () => {
  it('keeps only overdue, today, and soon candidates', () => {
    const filtered = filterCandidatesForDaily([
      {
        cid: 'c1',
        text: 'Overdue task',
        due_bucket: 'overdue',
        is_overdue: true,
        has_explicit_date: true,
      },
      {
        cid: 'c2',
        text: 'Today task',
        due_bucket: 'today',
        is_overdue: false,
        has_explicit_date: true,
      },
      {
        cid: 'c3',
        text: 'Soon task',
        due_bucket: 'soon',
        is_overdue: false,
        has_explicit_date: true,
      },
      {
        cid: 'c4',
        text: 'Later task',
        due_bucket: 'later',
        is_overdue: false,
        has_explicit_date: true,
      },
      {
        cid: 'c5',
        text: 'Backlog task',
        due_bucket: 'none',
        is_overdue: false,
        has_explicit_date: false,
      },
    ])

    expect(filtered.map((candidate) => candidate.cid)).toEqual(['c1', 'c2', 'c3'])
  })

  it('lets the server enforce bucket-specific cid allowlists after the model responds', () => {
    const mapped = mapTasksFromCids(
      [
        {
          task: 'Misbucketed soon item',
          cids: ['c-soon'],
          priority: 'high',
        },
      ],
      new Set(['c-today']),
      new Map([
        ['c-today', 'block-today'],
        ['c-soon', 'block-soon'],
      ]),
      new Map([
        ['c-today', 'Today task'],
        ['c-soon', 'Soon task'],
      ]),
    )

    expect(mapped.mapped).toEqual([])
    expect(mapped.removedForInvalidCids).toBe(1)
  })
})
