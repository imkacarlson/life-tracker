import { describe, it, expect } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { isMarkActiveForToggle } from '../smartMark'

// Minimal ProseMirror schema with a plain-text block plus a couple of marks.
// `underline` stands in for the inclusive Bold/Italic/Underline family; `em`
// is a second mark to confirm targeting is mark-specific.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
  },
  marks: {
    underline: {},
    em: {},
  },
})

const { doc, paragraph } = schema.nodes
const underline = schema.marks.underline
const em = schema.marks.em

const p = (text) => paragraph.create(null, text ? schema.text(text) : null)

// Build a base state, then mark [from, to] with the given mark.
const stateWithMark = (docNode, markType, from, to) => {
  let state = EditorState.create({ doc: docNode, schema })
  if (from != null && to != null) {
    state = state.apply(state.tr.addMark(from, to, markType.create()))
  }
  return state
}

const withCursor = (state, pos) =>
  state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))

const withSelection = (state, from, to) =>
  state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)))

describe('isMarkActiveForToggle', () => {
  // doc: paragraph("hello world") -> text starts at doc pos 1.
  // positions: h=1 e=2 l=3 l=4 o=5 (space)=6 w=7 o=8 r=9 l=10 d=11, end=12
  // Underline the first word "hello" = [1, 6].
  const d = doc.create(null, [p('hello world')])

  it('returns true with caret at the start of a marked word', () => {
    const state = withCursor(stateWithMark(d, underline, 1, 6), 1)
    expect(isMarkActiveForToggle(state, underline)).toBe(true)
  })

  it('returns true with caret in the middle of a marked word', () => {
    const state = withCursor(stateWithMark(d, underline, 1, 6), 3)
    expect(isMarkActiveForToggle(state, underline)).toBe(true)
  })

  it('returns true with caret at the end of a marked word', () => {
    const state = withCursor(stateWithMark(d, underline, 1, 6), 6)
    expect(isMarkActiveForToggle(state, underline)).toBe(true)
  })

  it('returns false with caret anywhere in an unmarked word', () => {
    const state = withCursor(stateWithMark(d, underline, 1, 6), 9) // inside "world"
    expect(isMarkActiveForToggle(state, underline)).toBe(false)
  })

  it('is mark-specific: an underlined word is not "italic active"', () => {
    const state = withCursor(stateWithMark(d, underline, 1, 6), 3)
    expect(isMarkActiveForToggle(state, em)).toBe(false)
  })

  it('returns true for a non-empty selection over marked text', () => {
    const state = withSelection(stateWithMark(d, underline, 1, 6), 1, 6)
    expect(isMarkActiveForToggle(state, underline)).toBe(true)
  })

  it('returns false for a non-empty selection over plain text', () => {
    const state = withSelection(stateWithMark(d, underline, 1, 6), 7, 12)
    expect(isMarkActiveForToggle(state, underline)).toBe(false)
  })

  it('reflects stored marks for a caret on whitespace between words', () => {
    // "hi  there": h=1 i=2 (sp)=3 (sp)=4 t=5 ...; caret at pos 4 sits between
    // two spaces (no word). With no stored mark applied -> false.
    const dd = doc.create(null, [p('hi  there')])
    const state = withCursor(stateWithMark(dd, underline), 4)
    expect(isMarkActiveForToggle(state, underline)).toBe(false)

    // With the mark in storedMarks, the whitespace caret reports active.
    const stored = state.apply(state.tr.addStoredMark(underline.create()))
    expect(isMarkActiveForToggle(stored, underline)).toBe(true)
  })

  it('returns false for an empty block', () => {
    const empty = doc.create(null, [p()])
    const state = withCursor(stateWithMark(empty, underline), 1)
    expect(isMarkActiveForToggle(state, underline)).toBe(false)
  })

  it('returns false for null/missing args', () => {
    expect(isMarkActiveForToggle(null, underline)).toBe(false)
    const state = withCursor(stateWithMark(d, underline, 1, 6), 3)
    expect(isMarkActiveForToggle(state, null)).toBe(false)
  })
})
