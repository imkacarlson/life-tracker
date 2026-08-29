import { describe, expect, it } from 'vitest'

import { decideScoresRun } from './scoresEnabled.ts'

describe('decideScoresRun', () => {
  it('does not run when the toggle is explicitly off', () => {
    expect(decideScoresRun({ sports_scores_enabled: false })).toEqual({
      run: false,
      reason: 'disabled',
    })
  })

  it('runs when the toggle is on', () => {
    expect(decideScoresRun({ sports_scores_enabled: true })).toEqual({ run: true })
  })

  it('runs when no settings row exists yet (column default is true)', () => {
    expect(decideScoresRun(null)).toEqual({ run: true })
    expect(decideScoresRun(undefined)).toEqual({ run: true })
  })

  it('runs when the column is null or absent on an older row', () => {
    expect(decideScoresRun({ sports_scores_enabled: null })).toEqual({ run: true })
    expect(decideScoresRun({})).toEqual({ run: true })
  })

  it('reports settings_unavailable on a query error', () => {
    expect(decideScoresRun(null, { message: 'boom' })).toEqual({
      run: false,
      reason: 'settings_unavailable',
    })
  })

  it('lets the error win over a row that says enabled', () => {
    expect(decideScoresRun({ sports_scores_enabled: true }, new Error('boom'))).toEqual({
      run: false,
      reason: 'settings_unavailable',
    })
  })

  it('reports settings_unavailable, not disabled, when both an error and false arrive', () => {
    expect(decideScoresRun({ sports_scores_enabled: false }, new Error('boom'))).toEqual({
      run: false,
      reason: 'settings_unavailable',
    })
  })
})
