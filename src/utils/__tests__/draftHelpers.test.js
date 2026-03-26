import { describe, it, expect } from 'vitest'
import { detectConflict } from '../draftHelpers'

describe('detectConflict', () => {
  const serverRow = (updatedAt) => ({
    updated_at: updatedAt,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    title: 'Server Title',
  })

  const draft = (ts) => ({
    ts,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    title: 'Draft Title',
  })

  it('returns conflict when server is newer than draft', () => {
    const server = serverRow('2026-03-25T12:00:00.000Z')
    const d = draft(new Date('2026-03-25T11:00:00.000Z').getTime())
    const result = detectConflict('page-1', server, d)
    expect(result).not.toBeNull()
    expect(result.trackerId).toBe('page-1')
    expect(result.serverUpdatedAt).toBe('2026-03-25T12:00:00.000Z')
    expect(result.draftTs).toBe(d.ts)
    expect(result.serverContent).toBe(server.content)
    expect(result.draftContent).toBe(d.content)
  })

  it('returns null when draft is newer than server', () => {
    const server = serverRow('2026-03-25T11:00:00.000Z')
    const d = draft(new Date('2026-03-25T12:00:00.000Z').getTime())
    expect(detectConflict('page-1', server, d)).toBeNull()
  })

  it('returns null when timestamps are equal', () => {
    const ts = new Date('2026-03-25T12:00:00.000Z').getTime()
    const server = serverRow('2026-03-25T12:00:00.000Z')
    const d = draft(ts)
    expect(detectConflict('page-1', server, d)).toBeNull()
  })

  it('returns null when trackerId is null', () => {
    const server = serverRow('2026-03-25T12:00:00.000Z')
    const d = draft(1000)
    expect(detectConflict(null, server, d)).toBeNull()
  })

  it('returns null when serverRow is null', () => {
    expect(detectConflict('page-1', null, draft(1000))).toBeNull()
  })

  it('returns null when draft is null', () => {
    expect(detectConflict('page-1', serverRow('2026-03-25T12:00:00.000Z'), null)).toBeNull()
  })

  it('returns null when draft.ts is falsy (0)', () => {
    expect(detectConflict('page-1', serverRow('2026-03-25T12:00:00.000Z'), draft(0))).toBeNull()
  })

  it('handles Postgres +00:00 format correctly', () => {
    // Supabase sometimes returns +00:00 instead of Z
    const server = serverRow('2026-03-25T12:00:00.000+00:00')
    const d = draft(new Date('2026-03-25T11:00:00.000Z').getTime())
    const result = detectConflict('page-1', server, d)
    expect(result).not.toBeNull()
    expect(result.trackerId).toBe('page-1')
  })

  it('returns null when updated_at is null (NaN guard)', () => {
    const server = serverRow(null)
    const d = draft(new Date('2026-03-25T11:00:00.000Z').getTime())
    expect(detectConflict('page-1', server, d)).toBeNull()
  })

  it('returns null when updated_at is malformed (NaN guard)', () => {
    const server = serverRow('not-a-date')
    const d = draft(new Date('2026-03-25T11:00:00.000Z').getTime())
    expect(detectConflict('page-1', server, d)).toBeNull()
  })
})
