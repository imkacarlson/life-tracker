import { describe, it, expect } from 'vitest'
import { classifySaveResult } from '../saveConflict'

describe('classifySaveResult', () => {
  it('returns ok with the server timestamp when the row was updated', () => {
    const result = classifySaveResult({
      data: { updated_at: '2026-05-10T12:00:00.000Z' },
      error: null,
      knownTs: '2026-05-10T11:00:00.000Z',
    })
    expect(result).toEqual({
      kind: 'ok',
      nextKnownTs: '2026-05-10T12:00:00.000Z',
    })
  })

  it('returns conflict when no row matched (PostgREST single() with no rows)', () => {
    // Supabase .single() with zero rows returns data:null and a PGRST116 error.
    const result = classifySaveResult({
      data: null,
      error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
      knownTs: '2026-05-10T11:00:00.000Z',
    })
    expect(result.kind).toBe('conflict')
  })

  it('returns conflict when data is null without an error code (zero rows matched)', () => {
    const result = classifySaveResult({
      data: null,
      error: null,
      knownTs: '2026-05-10T11:00:00.000Z',
    })
    expect(result.kind).toBe('conflict')
  })

  it('returns error for a real network or server error (not PGRST116)', () => {
    const err = { code: '08006', message: 'connection failure' }
    const result = classifySaveResult({
      data: null,
      error: err,
      knownTs: '2026-05-10T11:00:00.000Z',
    })
    expect(result).toEqual({ kind: 'error', error: err })
  })

  it('returns error when knownTs is missing (cannot do OCC without a version token)', () => {
    const result = classifySaveResult({
      data: null,
      error: null,
      knownTs: null,
    })
    expect(result.kind).toBe('error')
  })
})
