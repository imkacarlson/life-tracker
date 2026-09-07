import { describe, expect, it } from 'vitest'

import { decideNotifyAction } from './notifyState.ts'

describe('decideNotifyAction', () => {
  it('skips a game that was already emailed', () => {
    expect(
      decideNotifyAction({
        id: 'row-1',
        notified_at: '2026-09-05T21:15:40.000Z',
        ai_summary: 'a summary',
      }),
    ).toEqual({ action: 'skip' })
  })

  it('retries a game that was recorded but never emailed', () => {
    // The 2026-09-05 Indiana case: row committed, worker killed, email never sent.
    expect(
      decideNotifyAction({ id: 'row-2', notified_at: null, ai_summary: null }),
    ).toEqual({ action: 'retry', scoreHistoryId: 'row-2', reuseSummary: null })
  })

  it('reuses a summary an earlier attempt already paid for', () => {
    expect(
      decideNotifyAction({ id: 'row-3', notified_at: null, ai_summary: 'earlier blurb' }),
    ).toEqual({ action: 'retry', scoreHistoryId: 'row-3', reuseSummary: 'earlier blurb' })
  })

  it('skips when the row has gone (a retention purge racing the insert)', () => {
    expect(decideNotifyAction(null)).toEqual({ action: 'skip' })
    expect(decideNotifyAction(undefined)).toEqual({ action: 'skip' })
  })
})
