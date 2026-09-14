import { describe, expect, it } from 'vitest'

import { decideNotifyAction, decideSendAction } from './notifyState.ts'

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

describe('decideSendAction', () => {
  const HOLD = 5 * 60_000

  it('sends immediately once a summary exists', () => {
    expect(decideSendAction({ hasSummary: true, ageMs: 0, holdMs: HOLD })).toBe('send')
  })

  it('holds a fresh game whose summary is still missing', () => {
    // The whole point: gemini-2.5-flash hangs often enough that one attempt in
    // the 60s before the email usually misses, and sending now loses the blurb
    // for good.
    expect(decideSendAction({ hasSummary: false, ageMs: 0, holdMs: HOLD })).toBe('hold')
    expect(decideSendAction({ hasSummary: false, ageMs: HOLD - 1, holdMs: HOLD })).toBe('hold')
  })

  it('sends without a summary once the hold window is up', () => {
    // THE load-bearing test. The email always goes; the blurb is garnish. If
    // this ever returns 'hold', a Gemini outage silently swallows the email --
    // which is the 2026-09-05 failure this whole design exists to prevent.
    expect(decideSendAction({ hasSummary: false, ageMs: HOLD, holdMs: HOLD })).toBe('send')
    expect(decideSendAction({ hasSummary: false, ageMs: HOLD * 100, holdMs: HOLD })).toBe('send')
  })

  it('never holds when the window is zero or negative', () => {
    // So the behavior can be switched off by configuration alone, with no code
    // change, if holding ever turns out to be a bad trade.
    expect(decideSendAction({ hasSummary: false, ageMs: 0, holdMs: 0 })).toBe('send')
    expect(decideSendAction({ hasSummary: false, ageMs: 0, holdMs: -1 })).toBe('send')
  })
})
