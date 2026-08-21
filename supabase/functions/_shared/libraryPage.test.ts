import { describe, expect, it } from 'vitest'

import {
  CAPTURE_HEADINGS,
  appendDatedNote,
  buildCapturePage,
  shortDateLabel,
} from './libraryPage.ts'

const flatten = (node: any): string => {
  if (!node) return ''
  if (node.text) return node.text
  return (node.content ?? []).map(flatten).join('')
}

const headings = (doc: any) =>
  (doc.content ?? []).filter((n: any) => n.type === 'heading').map(flatten)

const notesItems = (doc: any) => {
  const top = doc.content ?? []
  const i = top.findIndex((n: any) => n.type === 'heading' && flatten(n) === CAPTURE_HEADINGS.notes)
  const list = top.slice(i + 1).find((n: any) => n.type === 'bulletList')
  return (list?.content ?? []).map(flatten)
}

const SOURCE = {
  sourceType: 'article',
  url: 'https://example.com/fueling',
  title: 'Carbohydrate intake during long runs',
  site: 'example.com',
  author: 'A Writer',
  published: '2026-03-01',
  extractStatus: 'ok',
}

describe('buildCapturePage', () => {
  const doc = buildCapturePage({
    summary: 'Covers carbohydrate intake rates during long efforts.',
    note: 'worth revisiting before the fall build',
    source: SOURCE,
    dateLabel: 'Aug 19',
  })

  it('has the three sections, in order', () => {
    expect(headings(doc)).toEqual(['Summary', 'My notes', 'Source'])
  })

  it('puts the model-written summary under Summary', () => {
    expect(flatten(doc)).toContain('Covers carbohydrate intake rates')
  })

  it("dates the user's note", () => {
    expect(notesItems(doc)).toEqual(['Aug 19 — worth revisiting before the fall build'])
  })

  it('links out to the source with its provenance', () => {
    const flat = flatten(doc)
    expect(flat).toContain('Carbohydrate intake during long runs')
    expect(flat).toContain('example.com · A Writer · 2026-03-01')
    expect(JSON.stringify(doc)).toContain('https://example.com/fueling')
  })

  it('does NOT contain the full extracted text', () => {
    // source_text lives in library_sources, deliberately: a 10 KB article in
    // pages.content would be re-shipped by autosave every ~2s while typing.
    expect(JSON.stringify(doc).length).toBeLessThan(4000)
  })

  it('gives every block an id, so a preview can highlight one', () => {
    for (const node of doc.content ?? []) {
      if (node.type === 'heading' || node.type === 'paragraph' || node.type === 'bulletList') {
        expect(typeof node.attrs?.id).toBe('string')
      }
    }
  })

  it('handles a capture with no note yet', () => {
    const bare = buildCapturePage({ summary: 'S.', source: SOURCE, dateLabel: 'Aug 19' })
    expect(headings(bare)).toContain('My notes')
    expect(notesItems(bare)).toEqual([''])
  })
})

describe('buildCapturePage — failing loudly', () => {
  it('says on the page when the site blocked the fetch', () => {
    const doc = buildCapturePage({
      summary: 'Saved the headline only.',
      source: { ...SOURCE, extractStatus: 'blocked' },
      dateLabel: 'Aug 19',
    })
    expect(flatten(doc)).toContain('the site blocked it')
  })

  it('says on the page when only a stub came back', () => {
    const doc = buildCapturePage({
      summary: 'S.',
      source: { ...SOURCE, extractStatus: 'thin' },
      dateLabel: 'Aug 19',
    })
    expect(flatten(doc)).toContain('Only got a stub')
  })

  it('stays quiet when the fetch worked', () => {
    const doc = buildCapturePage({ summary: 'S.', source: SOURCE, dateLabel: 'Aug 19' })
    expect(flatten(doc)).not.toContain("Couldn't read")
    expect(flatten(doc)).not.toContain('stub')
  })

  it('handles a note with no link at all', () => {
    const doc = buildCapturePage({
      summary: 'A thought the user wanted to keep.',
      note: 'tapering is mostly psychological',
      source: { sourceType: 'note', extractStatus: 'none' },
      dateLabel: 'Aug 19',
    })
    expect(flatten(doc)).toContain('No link — this is a note.')
    expect(notesItems(doc)).toEqual(['Aug 19 — tapering is mostly psychological'])
  })
})

describe('appendDatedNote', () => {
  const base = buildCapturePage({
    summary: 'Original summary.',
    note: 'first thought',
    source: SOURCE,
    dateLabel: 'Aug 19',
  })

  it('adds a second dated note under My notes', () => {
    const { doc } = appendDatedNote(base, 'second thought', 'Aug 20')
    expect(notesItems(doc)).toEqual([
      'Aug 19 — first thought',
      'Aug 20 — second thought',
    ])
  })

  it('never touches the summary or the source', () => {
    const { doc } = appendDatedNote(base, 'second thought', 'Aug 20')
    expect(flatten(doc)).toContain('Original summary.')
    expect(JSON.stringify(doc)).toContain('https://example.com/fueling')
  })

  it('does not mutate the original document', () => {
    const before = JSON.stringify(base)
    appendDatedNote(base, 'second thought', 'Aug 20')
    expect(JSON.stringify(base)).toBe(before)
  })

  it('returns the new block id so the preview can highlight it', () => {
    const { doc, blockId } = appendDatedNote(base, 'second thought', 'Aug 20')
    expect(typeof blockId).toBe('string')
    // The id must actually be IN the returned doc — highlighting an id that
    // isn't there renders an uncropped, unhighlighted preview.
    expect(JSON.stringify(doc)).toContain(blockId)
  })

  it('replaces the empty placeholder on a capture saved without a note', () => {
    const bare = buildCapturePage({ summary: 'S.', source: SOURCE, dateLabel: 'Aug 19' })
    const { doc } = appendDatedNote(bare, 'a later thought', 'Aug 22')
    expect(notesItems(doc)).toEqual(['Aug 22 — a later thought'])
  })

  it('survives a page the user restructured, rather than dropping the note', () => {
    const restructured = { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'I rewrote this page.' }] }] }
    const { doc } = appendDatedNote(restructured, 'still keep this', 'Aug 21')
    expect(flatten(doc)).toContain('I rewrote this page.')
    expect(flatten(doc)).toContain('Aug 21 — still keep this')
  })

  it('handles a notes heading with no list under it', () => {
    const odd = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { id: 'h1', level: 2 }, content: [{ type: 'text', text: 'My notes' }] },
        { type: 'heading', attrs: { id: 'h2', level: 2 }, content: [{ type: 'text', text: 'Source' }] },
      ],
    }
    const { doc } = appendDatedNote(odd, 'recovered', 'Aug 21')
    expect(notesItems(doc)).toEqual(['Aug 21 — recovered'])
    // The Source heading is still there, after the inserted list.
    expect(headings(doc)).toEqual(['My notes', 'Source'])
  })
})

describe('shortDateLabel', () => {
  it('formats in the user\'s zone, not UTC', () => {
    // 03:30 UTC on Aug 20 is still Aug 19 in New York.
    const instant = new Date('2026-08-20T03:30:00Z')
    expect(shortDateLabel(instant, 'America/New_York')).toBe('Aug 19')
    expect(shortDateLabel(instant, 'UTC')).toBe('Aug 20')
  })
})
