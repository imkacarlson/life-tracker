import { describe, it, expect } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import {
  extractSearchableBlocks,
  resolveBlockRanges,
  buildSearchCacheKey,
} from '../aiSearchHelpers'

// --- extractSearchableBlocks (plain JSON) --------------------------------

describe('extractSearchableBlocks', () => {
  it('returns one {id,text} per text-bearing block', () => {
    const docJson = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { id: 'h1', level: 1 },
          content: [{ type: 'text', text: 'Running' }],
        },
        {
          type: 'paragraph',
          attrs: { id: 'p1' },
          content: [{ type: 'text', text: 'Long run Saturday' }],
        },
      ],
    }
    expect(extractSearchableBlocks(docJson)).toEqual([
      { id: 'h1', text: 'Running' },
      { id: 'p1', text: 'Long run Saturday' },
    ])
  })

  it('collects paragraphs nested inside list items', () => {
    const docJson = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          attrs: { id: 'ul1' },
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  attrs: { id: 'li-p1' },
                  content: [{ type: 'text', text: 'Send Jerry a weekly update' }],
                },
              ],
            },
          ],
        },
      ],
    }
    expect(extractSearchableBlocks(docJson)).toEqual([
      { id: 'li-p1', text: 'Send Jerry a weekly update' },
    ])
  })

  it('collects paragraphs inside table cells', () => {
    const docJson = {
      type: 'doc',
      content: [
        {
          type: 'table',
          attrs: { id: 't1' },
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'paragraph',
                      attrs: { id: 'cell-p1' },
                      content: [{ type: 'text', text: 'Pay rent' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    expect(extractSearchableBlocks(docJson)).toEqual([
      { id: 'cell-p1', text: 'Pay rent' },
    ])
  })

  it('joins multiple inline text nodes (marks) into one block', () => {
    const docJson = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: 'p1' },
          content: [
            { type: 'text', text: 'Call ' },
            { type: 'text', marks: [{ type: 'bold' }], text: 'Dr. Smith' },
            { type: 'text', text: ' tomorrow' },
          ],
        },
      ],
    }
    expect(extractSearchableBlocks(docJson)).toEqual([
      { id: 'p1', text: 'Call Dr. Smith tomorrow' },
    ])
  })

  it('skips empty/whitespace blocks and blocks without an id', () => {
    const docJson = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: '   ' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'no id here' }] },
        { type: 'paragraph', attrs: { id: 'p2' } },
        { type: 'paragraph', attrs: { id: 'p3' }, content: [{ type: 'text', text: 'kept' }] },
      ],
    }
    expect(extractSearchableBlocks(docJson)).toEqual([{ id: 'p3', text: 'kept' }])
  })

  it('does not emit the same id twice', () => {
    const docJson = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { id: 'dup' }, content: [{ type: 'text', text: 'first' }] },
        { type: 'paragraph', attrs: { id: 'dup' }, content: [{ type: 'text', text: 'second' }] },
      ],
    }
    expect(extractSearchableBlocks(docJson)).toEqual([{ id: 'dup', text: 'first' }])
  })

  it('returns [] for empty or malformed input', () => {
    expect(extractSearchableBlocks(null)).toEqual([])
    expect(extractSearchableBlocks({})).toEqual([])
    expect(extractSearchableBlocks({ type: 'doc' })).toEqual([])
  })
})

// --- resolveBlockRanges (real ProseMirror doc) ---------------------------

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      attrs: { id: { default: null } },
    },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { id: { default: null }, level: { default: 1 } },
    },
    text: { group: 'inline' },
    bulletList: {
      group: 'block',
      content: 'listItem+',
      attrs: { id: { default: null } },
    },
    listItem: { content: 'block+', defining: true },
  },
})

const { doc, paragraph, heading, bulletList, listItem } = schema.nodes
const p = (id, txt) => paragraph.create({ id }, txt ? schema.text(txt) : null)

describe('resolveBlockRanges', () => {
  it('returns whole-node ranges for matching ids, sorted by from', () => {
    const d = doc.create(null, [
      p('a', 'first'),
      p('b', 'second'),
      p('c', 'third'),
    ])
    const ranges = resolveBlockRanges(d, new Set(['a', 'c']))
    expect(ranges).toHaveLength(2)
    // Each range covers the full node: to === from + nodeSize.
    d.descendants((node, pos) => {
      if (node.attrs?.id === 'a') {
        expect(ranges[0]).toEqual({ from: pos, to: pos + node.nodeSize })
      }
      if (node.attrs?.id === 'c') {
        expect(ranges[1]).toEqual({ from: pos, to: pos + node.nodeSize })
      }
    })
    // sorted
    expect(ranges[0].from).toBeLessThan(ranges[1].from)
  })

  it('accepts an array of ids', () => {
    const d = doc.create(null, [p('a', 'x'), p('b', 'y')])
    expect(resolveBlockRanges(d, ['b'])).toHaveLength(1)
  })

  it('resolves nested list paragraph ids and a heading', () => {
    const d = doc.create(null, [
      heading.create({ id: 'h', level: 1 }, schema.text('Title')),
      bulletList.create({ id: 'ul' }, [listItem.create(null, [p('li-p', 'bullet text')])]),
    ])
    const ranges = resolveBlockRanges(d, new Set(['li-p']))
    expect(ranges).toHaveLength(1)
    const node = d.nodeAt(ranges[0].from)
    expect(node?.attrs?.id).toBe('li-p')
  })

  it('returns [] when no ids match or set is empty', () => {
    const d = doc.create(null, [p('a', 'x')])
    expect(resolveBlockRanges(d, new Set(['zzz']))).toEqual([])
    expect(resolveBlockRanges(d, new Set())).toEqual([])
    expect(resolveBlockRanges(null, new Set(['a']))).toEqual([])
  })
})

// --- buildSearchCacheKey -------------------------------------------------

describe('buildSearchCacheKey', () => {
  it('combines version and normalized query', () => {
    expect(buildSearchCacheKey(5, 'Find Me')).toBe('5::find me')
  })

  it('normalizes whitespace and case so re-typing is a cache hit', () => {
    expect(buildSearchCacheKey('v1', '  Follow Up  ')).toBe(buildSearchCacheKey('v1', 'follow up'))
  })

  it('different versions produce different keys', () => {
    expect(buildSearchCacheKey(1, 'q')).not.toBe(buildSearchCacheKey(2, 'q'))
  })
})
