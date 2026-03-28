import { describe, it, expect } from 'vitest'
import { detectConflict } from '../draftHelpers'

describe('detectConflict', () => {
  // Server and draft with DIFFERENT content (the conflict-worthy case).
  const serverRow = (updatedAt) => ({
    updated_at: updatedAt,
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'server' }] }] },
    title: 'Server Title',
  })

  const draft = (ts) => ({
    ts,
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'draft' }] }] },
    title: 'Draft Title',
  })

  it('returns conflict when server is newer than draft and content differs', () => {
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

  // Content equality tests (issue #99: prevent false conflict on stale drafts)

  it('returns null when content is identical even if server is newer', () => {
    const sharedContent = { type: 'doc', content: [{ type: 'paragraph' }] }
    const server = { updated_at: '2026-03-25T12:00:00.000Z', content: sharedContent, title: 'Title' }
    const d = { ts: new Date('2026-03-25T11:00:00.000Z').getTime(), content: sharedContent, title: 'Title' }
    expect(detectConflict('page-1', server, d)).toBeNull()
  })

  it('returns null when content is identical and draft is newer', () => {
    const sharedContent = { type: 'doc', content: [{ type: 'paragraph' }] }
    const server = { updated_at: '2026-03-25T11:00:00.000Z', content: sharedContent, title: 'Title' }
    const d = { ts: new Date('2026-03-25T12:00:00.000Z').getTime(), content: sharedContent, title: 'Title' }
    expect(detectConflict('page-1', server, d)).toBeNull()
  })

  it('returns null when content is identical but titles differ', () => {
    // Title mismatch alone is not a conflict worth blocking the user for;
    // the content equality check takes precedence.
    const sharedContent = { type: 'doc', content: [{ type: 'paragraph' }] }
    const server = { updated_at: '2026-03-25T12:00:00.000Z', content: sharedContent, title: 'Server' }
    const d = { ts: new Date('2026-03-25T11:00:00.000Z').getTime(), content: sharedContent, title: 'Draft' }
    expect(detectConflict('page-1', server, d)).toBeNull()
  })

  it('returns conflict when content differs and server is newer', () => {
    const server = {
      updated_at: '2026-03-25T12:00:00.000Z',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
      title: 'Title',
    }
    const d = {
      ts: new Date('2026-03-25T11:00:00.000Z').getTime(),
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] },
      title: 'Title',
    }
    const result = detectConflict('page-1', server, d)
    expect(result).not.toBeNull()
    expect(result.trackerId).toBe('page-1')
  })

  it('returns null when draft.content is missing', () => {
    const server = serverRow('2026-03-25T12:00:00.000Z')
    const d = { ts: new Date('2026-03-25T11:00:00.000Z').getTime(), title: 'Draft' }
    expect(detectConflict('page-1', server, d)).toBeNull()
  })
})
