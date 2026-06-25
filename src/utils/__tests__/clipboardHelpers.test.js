import { describe, it, expect } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { stripClipboardIds } from '../clipboardHelpers'
import { isInternalLinkHref } from '../../extensions/editorExtensions'

// Minimal schema carrying the id/created_at block attrs the stripper targets,
// plus a highlight mark to prove marks survive the strip.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      attrs: { id: { default: null }, created_at: { default: null } },
    },
    bulletList: {
      group: 'block',
      content: 'listItem+',
      attrs: { id: { default: null }, created_at: { default: null } },
    },
    listItem: { content: 'block+' },
    text: { group: 'inline' },
  },
  marks: {
    highlight: { attrs: { color: { default: null } } },
  },
})

const { doc, paragraph, bulletList, listItem } = schema.nodes
const highlight = schema.marks.highlight

const sliceOf = (node) => {
  // openStart/openEnd 0 for a closed top-level fragment built directly.
  return { content: node.content, openStart: 0, openEnd: 0 }
}

describe('stripClipboardIds', () => {
  it('clears id and created_at on block nodes', () => {
    const p = paragraph.create(
      { id: 'p-1', created_at: '2026-01-01T00:00:00Z' },
      schema.text('hello'),
    )
    const d = doc.create(null, [p])
    const result = stripClipboardIds(sliceOf(d))
    const out = result.content.firstChild
    expect(out.attrs.id).toBeNull()
    expect(out.attrs.created_at).toBeNull()
  })

  it('preserves text and marks while clearing ids', () => {
    const marked = schema.text('hi', [highlight.create({ color: '#fef08a' })])
    const p = paragraph.create({ id: 'p-1', created_at: 'x' }, marked)
    const d = doc.create(null, [p])
    const result = stripClipboardIds(sliceOf(d))
    const textNode = result.content.firstChild.firstChild
    expect(textNode.text).toBe('hi')
    expect(textNode.marks).toHaveLength(1)
    expect(textNode.marks[0].attrs.color).toBe('#fef08a')
  })

  it('clears ids on nested block nodes too', () => {
    const inner = paragraph.create({ id: 'p-inner', created_at: 'x' }, schema.text('deep'))
    const li = listItem.create(null, [inner])
    const list = bulletList.create({ id: 'bl-1', created_at: 'x' }, [li])
    const d = doc.create(null, [list])
    const result = stripClipboardIds(sliceOf(d))
    const listOut = result.content.firstChild
    expect(listOut.attrs.id).toBeNull()
    const paraOut = listOut.firstChild.firstChild
    expect(paraOut.attrs.id).toBeNull()
    expect(paraOut.attrs.created_at).toBeNull()
    expect(paraOut.firstChild.text).toBe('deep')
  })

  it('keeps the slice open boundaries intact', () => {
    const p = paragraph.create({ id: 'p-1' }, schema.text('abc'))
    const d = doc.create(null, [p])
    const original = { content: d.content, openStart: 1, openEnd: 1 }
    const result = stripClipboardIds(original)
    expect(result.openStart).toBe(1)
    expect(result.openEnd).toBe(1)
  })

  it('does not mutate the source node attrs', () => {
    const p = paragraph.create({ id: 'p-1', created_at: 'x' }, schema.text('a'))
    const d = doc.create(null, [p])
    stripClipboardIds(sliceOf(d))
    expect(p.attrs.id).toBe('p-1')
  })
})

describe('isInternalLinkHref', () => {
  it('recognizes page, section, and notebook fragment hrefs', () => {
    expect(isInternalLinkHref('#pg=abc123')).toBe(true)
    expect(isInternalLinkHref('#sec=xyz')).toBe(true)
    expect(isInternalLinkHref('#nb=foo')).toBe(true)
  })

  it('rejects external and non-internal hrefs', () => {
    expect(isInternalLinkHref('https://example.com')).toBe(false)
    expect(isInternalLinkHref('mailto:a@b.com')).toBe(false)
    expect(isInternalLinkHref('#other=1')).toBe(false)
    expect(isInternalLinkHref('')).toBe(false)
    expect(isInternalLinkHref(null)).toBe(false)
    expect(isInternalLinkHref(undefined)).toBe(false)
  })
})
