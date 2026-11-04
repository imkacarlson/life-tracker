import { describe, it, expect } from 'vitest'
import {
  describeKeystroke,
  gunzipJson,
  gzipJson,
  pickReplayChunks,
  recordingChunkPath,
  summarizeSessions,
} from '../recordingHelpers'

const at = (minute) => new Date(Date.UTC(2026, 10, 4, 12, minute)).toISOString()
const chunk = (seq, startMinute, full) => ({
  seq,
  started_at: at(startMinute),
  ended_at: at(startMinute + 1),
  has_full_snapshot: full,
})

describe('recordingChunkPath', () => {
  it('nests chunks under user and session with a sortable sequence', () => {
    expect(recordingChunkPath('u1', 's1', 7)).toBe('u1/s1/000007.json.gz')
  })
})

describe('describeKeystroke', () => {
  it('never keeps keys typed into a password field', () => {
    expect(describeKeystroke({ key: 'a', target: { type: 'password', tagName: 'INPUT' } })).toBeNull()
  })

  it('keeps the key and modifiers otherwise', () => {
    const target = { tagName: 'DIV', closest: () => ({}) }
    expect(describeKeystroke({ key: 'b', code: 'KeyB', ctrlKey: true, target })).toEqual({
      key: 'b',
      code: 'KeyB',
      ctrl: true,
      meta: false,
      alt: false,
      shift: false,
      repeat: false,
      target: 'div',
      in_editor: true,
    })
  })
})

describe('pickReplayChunks', () => {
  const chunks = [chunk(0, 0, true), chunk(1, 1, false), chunk(2, 10, true), chunk(3, 11, false), chunk(4, 12, false)]

  it('starts at the last full snapshot before the range', () => {
    const picked = pickReplayChunks(chunks, Date.parse(at(11)), Date.parse(at(11)))
    expect(picked.map((c) => c.seq)).toEqual([2, 3])
  })

  it('falls back to the first full snapshot when the range is earlier', () => {
    const late = [chunk(5, 20, false), chunk(6, 21, true), chunk(7, 22, false)]
    expect(pickReplayChunks(late, Date.parse(at(19)), Date.parse(at(22))).map((c) => c.seq)).toEqual([6, 7])
  })

  it('returns nothing when no chunk can start a replay', () => {
    expect(pickReplayChunks([chunk(0, 0, false)], 0, Date.parse(at(5)))).toEqual([])
  })
})

describe('summarizeSessions', () => {
  it('rolls chunks up per session, newest session first', () => {
    const rows = [
      { session_id: 'b', device: 'phone', started_at: at(30), ended_at: at(31), bytes: 10 },
      { session_id: 'a', device: 'desktop', started_at: at(1), ended_at: at(2), bytes: 5 },
      { session_id: 'a', device: 'desktop', started_at: at(0), ended_at: at(1), bytes: 5 },
    ]
    expect(summarizeSessions(rows)).toEqual([
      { sessionId: 'b', device: 'phone', startedAt: at(30), endedAt: at(31), bytes: 10 },
      { sessionId: 'a', device: 'desktop', startedAt: at(0), endedAt: at(2), bytes: 10 },
    ])
  })
})

describe('gzipJson / gunzipJson', () => {
  it('round-trips a value', async () => {
    const value = [{ type: 2, timestamp: 1, data: { text: 'héllo' } }]
    const blob = await gzipJson(value)
    expect(await gunzipJson(blob)).toEqual(value)
  })

  it('reads plain JSON written without compression', async () => {
    expect(await gunzipJson(new Blob(['{"a":1}']))).toEqual({ a: 1 })
  })
})
