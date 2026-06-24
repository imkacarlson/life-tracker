import { describe, expect, it } from 'vitest'

import {
  buildCidBucketMap,
  filterCandidatesForDaily,
  routeTasksToBuckets,
} from './dailyHelpers.ts'

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
})

describe('buildCidBucketMap', () => {
  it('routes overdue/today to asap, soon to fyi, and ignores later/none', () => {
    const map = buildCidBucketMap([
      { cid: 'c1', text: 'Overdue', due_bucket: 'overdue', is_overdue: true, has_explicit_date: true },
      { cid: 'c2', text: 'Today', due_bucket: 'today', is_overdue: false, has_explicit_date: true },
      { cid: 'c3', text: 'Soon', due_bucket: 'soon', is_overdue: false, has_explicit_date: true },
      { cid: 'c4', text: 'Later', due_bucket: 'later', is_overdue: false, has_explicit_date: true },
      { cid: 'c5', text: 'None', due_bucket: 'none', is_overdue: false, has_explicit_date: false },
    ])

    expect(map.get('c1')).toBe('asap')
    expect(map.get('c2')).toBe('asap')
    expect(map.get('c3')).toBe('fyi')
    expect(map.has('c4')).toBe(false)
    expect(map.has('c5')).toBe(false)
  })
})

describe('routeTasksToBuckets', () => {
  const cidToBucket = buildCidBucketMap([
    { cid: 'c-today', text: 'Today task', due_bucket: 'today', is_overdue: false, has_explicit_date: true },
    { cid: 'c-soon', text: 'Soon task', due_bucket: 'soon', is_overdue: false, has_explicit_date: true },
  ])
  // cidToBlockId intentionally also knows a "later" cid that was never sent to
  // the model, mirroring production where the block map covers every next step.
  const cidToBlockId = new Map([
    ['c-today', 'block-today'],
    ['c-soon', 'block-soon'],
    ['c-later', 'block-later'],
  ])
  const cidToText = new Map([
    ['c-today', 'Today task'],
    ['c-soon', 'Soon task'],
    ['c-later', 'Later task'],
  ])

  it('places correctly-bucketed tasks into their bucket', () => {
    const routed = routeTasksToBuckets(
      [{ task: 'Do today thing', cids: ['c-today'], priority: 'high' }],
      cidToBucket,
      cidToBlockId,
      cidToText,
    )

    expect(routed.asap).toEqual([
      { task: 'Do today thing', block_ids: ['block-today'], priority: 'high' },
    ])
    expect(routed.fyi).toEqual([])
    expect(routed.droppedUnknownCids).toBe(0)
  })

  it('re-routes a mis-bucketed task to its correct bucket instead of dropping it', () => {
    // The model wrongly put a "soon" item in the ASAP list. It should land in FYI.
    const routed = routeTasksToBuckets(
      [{ task: 'Misbucketed soon item', cids: ['c-soon'], priority: 'high' }],
      cidToBucket,
      cidToBlockId,
      cidToText,
    )

    expect(routed.asap).toEqual([])
    expect(routed.fyi).toEqual([
      { task: 'Misbucketed soon item', block_ids: ['block-soon'], priority: 'high' },
    ])
    expect(routed.droppedUnknownCids).toBe(0)
  })

  it('silently drops unknown / out-of-scope cids without surfacing a task', () => {
    const routed = routeTasksToBuckets(
      [
        // c-later was never sent to the model (far-future); cX is invented.
        { task: '2027 taxes', cids: ['c-later'], priority: 'low' },
        { task: 'Hallucinated', cids: ['cX'], priority: 'low' },
      ],
      cidToBucket,
      cidToBlockId,
      cidToText,
    )

    expect(routed.asap).toEqual([])
    expect(routed.fyi).toEqual([])
    expect(routed.droppedUnknownCids).toBe(2)
  })

  it('falls back to candidate text when the model omits a task description', () => {
    const routed = routeTasksToBuckets(
      [{ task: '   ', cids: ['c-today'], priority: 'nonsense' }],
      cidToBucket,
      cidToBlockId,
      cidToText,
    )

    expect(routed.asap).toEqual([
      { task: 'Today task', block_ids: ['block-today'], priority: 'medium' },
    ])
  })

  it('skips tasks without a usable cids array', () => {
    const routed = routeTasksToBuckets(
      [{ task: 'No cids here', priority: 'high' }],
      cidToBucket,
      cidToBlockId,
      cidToText,
    )

    expect(routed.asap).toEqual([])
    expect(routed.fyi).toEqual([])
    expect(routed.droppedUnknownCids).toBe(0)
  })
})
