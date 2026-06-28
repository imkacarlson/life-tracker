import { describe, it, expect } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { isHighlightActiveForToggle } from '../highlightState'

// Minimal ProseMirror schema with a plain-text block plus a highlight mark.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
  },
  marks: {
    highlight: { inclusive: false },
  },
})

const { doc, paragraph } = schema.nodes
const highlight = schema.marks.highlight

const p = (text) => paragraph.create(null, text ? schema.text(text) : null)

// Build a base state, then mark [from, to] with highlight.
const stateWithHighlight = (docNode, from, to) => {
  let state = EditorState.create({ doc: docNode, schema })
  if (from != null && to != null) {
    state = state.apply(state.tr.addMark(from, to, highlight.create()))
  }
  return state
}

const withCursor = (state, pos) =>
  state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))

const withSelection = (state, from, to) =>
  state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)))

describe('isHighlightActiveForToggle', () => {
  // doc: paragraph("hello world") -> text starts at doc pos 1.
  // positions: h=1 e=2 l=3 l=4 o=5 (space)=6 w=7 o=8 r=9 l=10 d=11, end=12
  // Highlight the first word "hello" = [1, 6].
  const d = doc.create(null, [p('hello world')])

  it('returns true with caret at the start of a highlighted word', () => {
    const state = withCursor(stateWithHighlight(d, 1, 6), 1)
    expect(isHighlightActiveForToggle(state, highlight)).toBe(true)
  })

  it('returns true with caret in the middle of a highlighted word', () => {
    const state = withCursor(stateWithHighlight(d, 1, 6), 3)
    expect(isHighlightActiveForToggle(state, highlight)).toBe(true)
  })

  it('returns true with caret at the end of a highlighted word', () => {
    const state = withCursor(stateWithHighlight(d, 1, 6), 6)
    expect(isHighlightActiveForToggle(state, highlight)).toBe(true)
  })

  it('returns false with caret anywhere in a non-highlighted word', () => {
    const state = withCursor(stateWithHighlight(d, 1, 6), 9) // inside "world"
    expect(isHighlightActiveForToggle(state, highlight)).toBe(false)
  })

  it('returns true for a non-empty selection over highlighted text', () => {
    const state = withSelection(stateWithHighlight(d, 1, 6), 1, 6)
    expect(isHighlightActiveForToggle(state, highlight)).toBe(true)
  })

  it('returns false for a non-empty selection over plain text', () => {
    const state = withSelection(stateWithHighlight(d, 1, 6), 7, 12)
    expect(isHighlightActiveForToggle(state, highlight)).toBe(false)
  })

  it('returns false for caret on whitespace between words', () => {
    // "hi  there": h=1 i=2 (sp)=3 (sp)=4 t=5 ...; caret at pos 4 sits between
    // two spaces (no word). No highlight applied -> false.
    const dd = doc.create(null, [p('hi  there')])
    const state = withCursor(stateWithHighlight(dd), 4)
    expect(isHighlightActiveForToggle(state, highlight)).toBe(false)
  })

  it('returns false for an empty block', () => {
    const empty = doc.create(null, [p()])
    const state = withCursor(stateWithHighlight(empty), 1)
    expect(isHighlightActiveForToggle(state, highlight)).toBe(false)
  })
})
