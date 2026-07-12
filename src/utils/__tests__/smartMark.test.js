import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import {
  applyMarkSmart,
  isMarkActiveForBlockToggle,
  isMarkActiveForToggle,
  rangeFullyHasMark,
  toggleMarkSmart,
} from '../smartMark'

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

  it('returns false when a selected range is only partially marked', () => {
    const state = withSelection(stateWithMark(d, underline, 1, 6), 1, 12)
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

describe('isMarkActiveForBlockToggle', () => {
  const d = doc.create(null, [p('hello world')])

  it('uses the whole text block for a collapsed caret', () => {
    const state = withCursor(stateWithMark(d, underline, 1, 12), 9)
    expect(isMarkActiveForBlockToggle(state, underline)).toBe(true)
  })

  it('does not report active when another word in the same block has a different mark', () => {
    const state = withCursor(stateWithMark(d, em, 1, 6), 9)
    expect(isMarkActiveForBlockToggle(state, underline)).toBe(false)
  })

  it('does not report active when only part of the block has the target mark', () => {
    const state = withCursor(stateWithMark(d, underline, 1, 6), 9)
    expect(isMarkActiveForBlockToggle(state, underline)).toBe(false)
  })

  it('still uses the selected range when text is selected', () => {
    const state = withSelection(stateWithMark(d, underline, 1, 6), 7, 12)
    expect(isMarkActiveForBlockToggle(state, underline)).toBe(false)
  })
})

describe('rangeFullyHasMark', () => {
  const d = doc.create(null, [p('hello world')])

  it('returns true only when all text in the range has the mark', () => {
    const state = stateWithMark(d, underline, 1, 12)
    expect(rangeFullyHasMark(state, 1, 12, underline)).toBe(true)
  })

  it('returns false when only part of the text range has the mark', () => {
    const state = stateWithMark(d, underline, 1, 6)
    expect(rangeFullyHasMark(state, 1, 12, underline)).toBe(false)
  })
})

// --- applyMarkSmart / toggleMarkSmart ------------------------------------
//
// These operate on an `editor` (not a raw state), so we build a minimal fake
// that mimics the Tiptap chain: chain().focus().command(fn).run() runs each
// command against a single shared transaction and applies it, exactly like the
// real chain. syncSelectionFromDom bails out immediately because our stubbed
// window has no selection, so no editor view is needed.

// syncSelectionFromDom reads window.getSelection(); in the node test env there
// is no window. A stub returning null makes it bail before touching the view.
beforeAll(() => {
  globalThis.window = { getSelection: () => null }
})
afterAll(() => {
  delete globalThis.window
})

const makeEditor = (initialState) => {
  const editor = {
    state: initialState,
    schema: initialState.schema,
    isDestroyed: false,
    get view() {
      return null
    },
    chain() {
      const ops = []
      const api = {
        focus() {
          return api
        },
        command(fn) {
          ops.push(fn)
          return api
        },
        run() {
          const tr = editor.state.tr
          for (const fn of ops) {
            fn({ state: editor.state, tr, dispatch: () => {} })
          }
          editor.state = editor.state.apply(tr)
          return true
        },
      }
      return api
    },
  }
  return editor
}

// The marks that would apply to the NEXT typed character: explicit stored marks
// if set, otherwise the marks at the caret. This is what "arm continued typing"
// really means — when the caret lands inside a freshly-marked word, the marks at
// the cursor already carry the format, so addStoredMark is a no-op there.
const armedMarks = (state) => state.storedMarks || state.selection.$from.marks()
const isArmed = (state, markType) => markType.isInSet(armedMarks(state)) != null

describe('applyMarkSmart', () => {
  it('word-level: caret inside a word marks the whole word and arms typing', () => {
    // doc: p("hello world"); caret at pos 3 (inside "hello" = [1, 6]).
    const editor = makeEditor(withCursor(EditorState.create({ doc: doc.create(null, [p('hello world')]), schema }), 3))
    applyMarkSmart(editor, underline, { level: 'word' })

    // Whole word "hello" marked, "world" untouched.
    expect(rangeFullyHasMark(editor.state, 1, 6, underline)).toBe(true)
    expect(rangeFullyHasMark(editor.state, 7, 12, underline)).toBe(false)
    // Continued typing armed.
    expect(isArmed(editor.state, underline)).toBe(true)
  })

  it('word-level: caret on whitespace leaves the doc unchanged but arms typing', () => {
    // doc: p("hi  there"); caret at pos 4 sits between the two spaces (no word).
    const initial = withCursor(EditorState.create({ doc: doc.create(null, [p('hi  there')]), schema }), 4)
    const editor = makeEditor(initial)
    applyMarkSmart(editor, underline, { level: 'word' })

    // Nothing to grab: doc text is untouched, no mark applied anywhere.
    expect(editor.state.doc.eq(initial.doc)).toBe(true)
    expect(rangeFullyHasMark(editor.state, 1, 10, underline)).toBe(false)
    // But typing is armed.
    expect(isArmed(editor.state, underline)).toBe(true)
  })

  it('block-level: caret inside a line marks the whole block and arms typing', () => {
    // doc: p("hello world"); caret at pos 9 (inside "world"). Block = [1, 12].
    const editor = makeEditor(withCursor(EditorState.create({ doc: doc.create(null, [p('hello world')]), schema }), 9))
    applyMarkSmart(editor, underline, { level: 'block' })

    expect(rangeFullyHasMark(editor.state, 1, 12, underline)).toBe(true)
    expect(isArmed(editor.state, underline)).toBe(true)
  })

  it('remove: clears the range mark and disarms the stored mark', () => {
    // Start with "hello" underlined; caret inside it; remove.
    const marked = stateWithMark(doc.create(null, [p('hello world')]), underline, 1, 6)
    const editor = makeEditor(withCursor(marked, 3))
    applyMarkSmart(editor, underline, { level: 'word', remove: true })

    expect(rangeFullyHasMark(editor.state, 1, 6, underline)).toBe(false)
    // Stored mark removed (arming off), not carried into the next characters.
    expect(isArmed(editor.state, underline)).toBe(false)
  })

  it('formats a non-empty selection without arming', () => {
    // Select "world" [7, 12]; no collapsed caret, so no stored mark is set.
    const editor = makeEditor(
      withSelection(EditorState.create({ doc: doc.create(null, [p('hello world')]), schema }), 7, 12),
    )
    applyMarkSmart(editor, underline, { level: 'word' })

    expect(rangeFullyHasMark(editor.state, 7, 12, underline)).toBe(true)
    expect(isArmed(editor.state, underline)).toBe(false)
  })
})

describe('toggleMarkSmart', () => {
  it('applies the mark when the word target is not yet marked', () => {
    const editor = makeEditor(withCursor(EditorState.create({ doc: doc.create(null, [p('hello world')]), schema }), 3))
    toggleMarkSmart(editor, underline, { level: 'word' })
    expect(rangeFullyHasMark(editor.state, 1, 6, underline)).toBe(true)
  })

  it('removes the mark when the word target is already fully marked', () => {
    const marked = stateWithMark(doc.create(null, [p('hello world')]), underline, 1, 6)
    const editor = makeEditor(withCursor(marked, 3))
    toggleMarkSmart(editor, underline, { level: 'word' })
    expect(rangeFullyHasMark(editor.state, 1, 6, underline)).toBe(false)
  })

  it('block-level: removes when the whole block already carries the mark', () => {
    const marked = stateWithMark(doc.create(null, [p('hello world')]), underline, 1, 12)
    const editor = makeEditor(withCursor(marked, 9))
    toggleMarkSmart(editor, underline, { level: 'block' })
    expect(rangeFullyHasMark(editor.state, 1, 12, underline)).toBe(false)
  })
})
