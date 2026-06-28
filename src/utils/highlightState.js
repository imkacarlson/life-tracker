// Pure ProseMirror-state helper: decide whether the highlight toggle should
// remove (vs add). Mirrors setHighlightSmart's targeting so the toggle decision
// matches the action — the word under a collapsed caret, or the current
// selection — instead of relying on caret-adjacency marks (isActive), which the
// inclusive:false highlight mark gets wrong at word edges.

import { getWordRangeAt } from './wordRange'

/**
 * True when the highlight mark is present on the toggle target:
 * the word under a collapsed caret, or the current non-empty selection.
 *
 * @param {import('@tiptap/pm/state').EditorState} state
 * @param {import('@tiptap/pm/model').MarkType} markType
 * @returns {boolean}
 */
export const isHighlightActiveForToggle = (state, markType) => {
  if (!state || !markType) return false
  const { selection } = state

  if (selection.empty) {
    const range = getWordRangeAt(state)
    if (range) return state.doc.rangeHasMark(range.from, range.to, markType)
    // Caret on whitespace / empty block: fall back to stored/adjacent marks.
    const marks = state.storedMarks || selection.$from.marks()
    return marks.some((m) => m.type === markType)
  }

  return state.doc.rangeHasMark(selection.from, selection.to, markType)
}
