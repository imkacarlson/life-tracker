import { describe, it, expect } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { findBlockRangeById } from '../deepLinkSelection'

// Schema mirroring the editor's block types, with the `id` attr that deep links
// anchor to. Only what findBlockRangeById needs to walk + measure.
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

const t = (text) => schema.text(text)
const p = (attrs, text) => paragraph.create(attrs, text ? t(text) : null)
const h = (attrs, text) => heading.create(attrs, text ? t(text) : null)
const li = (...blocks) => listItem.create(null, blocks)
const ul = (attrs, ...items) => bulletList.create(attrs, items)

const makeState = (docNode) => EditorState.create({ doc: docNode, schema })

// The text content the resulting range should cover, used to assert correctness
// independent of exact integer positions.
const sliceText = (state, range) =>
  state.doc.textBetween(range.from, range.to, '\n', '\n')

describe('findBlockRangeById', () => {
  it('returns the inner text range for a paragraph', () => {
    const state = makeState(
      doc.create(null, [p({ id: 'a' }, 'before'), p({ id: 'target' }, 'hello world')]),
    )
    const range = findBlockRangeById(state, 'target')
    expect(range).not.toBeNull()
    expect(sliceText(state, range)).toBe('hello world')
  })

  it('returns the inner text range for a heading', () => {
    const state = makeState(
      doc.create(null, [h({ id: 'head', level: 2 }, 'My Section'), p({ id: 'b' }, 'body')]),
    )
    const range = findBlockRangeById(state, 'head')
    expect(range).not.toBeNull()
    expect(sliceText(state, range)).toBe('My Section')
  })

  it('spans the full text of a list container', () => {
    const state = makeState(
      doc.create(null, [
        ul({ id: 'list' }, li(p(null, 'one')), li(p(null, 'two'))),
      ]),
    )
    const range = findBlockRangeById(state, 'list')
    expect(range).not.toBeNull()
    // Selection snaps to text positions; covers both list items.
    expect(sliceText(state, range)).toContain('one')
    expect(sliceText(state, range)).toContain('two')
  })

  it('returns a collapsed range for an empty block', () => {
    const state = makeState(
      doc.create(null, [p({ id: 'empty' }), p({ id: 'c' }, 'after')]),
    )
    const range = findBlockRangeById(state, 'empty')
    expect(range).not.toBeNull()
    expect(range.from).toBe(range.to)
  })

  it('returns null for a missing id', () => {
    const state = makeState(doc.create(null, [p({ id: 'a' }, 'hello')]))
    expect(findBlockRangeById(state, 'does-not-exist')).toBeNull()
  })

  it('returns null when blockId is falsy', () => {
    const state = makeState(doc.create(null, [p({ id: 'a' }, 'hello')]))
    expect(findBlockRangeById(state, null)).toBeNull()
    expect(findBlockRangeById(state, '')).toBeNull()
  })

  it('produces a range usable as a real TextSelection', () => {
    const state = makeState(doc.create(null, [p({ id: 'target' }, 'select me')]))
    const range = findBlockRangeById(state, 'target')
    const selection = TextSelection.create(state.doc, range.from, range.to)
    expect(selection.empty).toBe(false)
    expect(state.doc.textBetween(selection.from, selection.to)).toBe('select me')
  })
})
