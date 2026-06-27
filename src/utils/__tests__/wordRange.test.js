import { describe, it, expect } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { getWordRangeAt } from '../wordRange'

// Minimal ProseMirror schema with a plain-text block.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
  },
})

const { doc, paragraph } = schema.nodes

const p = (text) => paragraph.create(null, text ? schema.text(text) : null)

// Build a state with a collapsed cursor at the given document position.
const stateWithCursor = (docNode, pos) => {
  const state = EditorState.create({ doc: docNode, schema })
  const selection = TextSelection.create(state.doc, pos)
  return state.apply(state.tr.setSelection(selection))
}

// Build a state with a non-empty selection.
const stateWithSelection = (docNode, from, to) => {
  const state = EditorState.create({ doc: docNode, schema })
  const selection = TextSelection.create(state.doc, from, to)
  return state.apply(state.tr.setSelection(selection))
}

describe('getWordRangeAt', () => {
  // doc: paragraph("hello world") -> text starts at doc pos 1.
  // positions: h=1 e=2 l=3 l=4 o=5 (space)=6 w=7 o=8 r=9 l=10 d=11, end=12
  const d = doc.create(null, [p('hello world')])

  it('spans the full word with the cursor in the middle', () => {
    // Cursor after "hel" (pos 4) -> "hello" = [1, 6]
    const state = stateWithCursor(d, 4)
    expect(getWordRangeAt(state)).toEqual({ from: 1, to: 6 })
  })

  it('spans the full word with the cursor at the word start edge', () => {
    // Cursor right before "world" (pos 7) -> "world" = [7, 12]
    const state = stateWithCursor(d, 7)
    expect(getWordRangeAt(state)).toEqual({ from: 7, to: 12 })
  })

  it('spans the full word with the cursor at the word end edge', () => {
    // Cursor right after "hello" (pos 6) -> "hello" = [1, 6]
    const state = stateWithCursor(d, 6)
    expect(getWordRangeAt(state)).toEqual({ from: 1, to: 6 })
  })

  it('spans the first word of the block (boundary at block start)', () => {
    // Cursor at very start (pos 1) -> "hello" = [1, 6]
    const state = stateWithCursor(d, 1)
    expect(getWordRangeAt(state)).toEqual({ from: 1, to: 6 })
  })

  it('spans the last word of the block (boundary at block end)', () => {
    // Cursor at very end (pos 12) -> "world" = [7, 12]
    const state = stateWithCursor(d, 12)
    expect(getWordRangeAt(state)).toEqual({ from: 7, to: 12 })
  })

  it('returns null when the cursor sits on a space between words', () => {
    // Cursor between "hello" and "world" (pos 6 is the end edge of hello —
    // already covered above; pos for the space char itself is offset 5,
    // i.e. cursor at pos 6 maps to hello). The space is at offset 5; a cursor
    // surrounded by whitespace requires double spaces.
    const dd = doc.create(null, [p('hi  there')])
    // text: h=1 i=2 (sp)=3 (sp)=4 t=5 ...; cursor at pos 4 is between two spaces.
    const state = stateWithCursor(dd, 4)
    expect(getWordRangeAt(state)).toBeNull()
  })

  it('returns null for a non-empty selection', () => {
    const state = stateWithSelection(d, 1, 6)
    expect(getWordRangeAt(state)).toBeNull()
  })

  it('returns null for an empty block', () => {
    const empty = doc.create(null, [p()])
    const state = stateWithCursor(empty, 1)
    expect(getWordRangeAt(state)).toBeNull()
  })
})
