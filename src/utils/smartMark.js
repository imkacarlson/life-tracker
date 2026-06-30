// Shared, mark-agnostic helpers for "word-level" cursor formatting. These
// generalize the highlight behavior so Bold, Italic, Underline, Text color, and
// Highlight all act on the whole word under a collapsed caret WITHOUT moving the
// caret or showing a native blue selection overlay.
//
// The single code path lives here; the toolbar tools and highlightState re-use
// it so there is one implementation, not a parallel system per mark.

import { TextSelection } from '@tiptap/pm/state'
import { getWordRangeAt } from './wordRange'
import { getMountedEditorView } from './editorView'

/**
 * Sync the DOM selection into ProseMirror. On touch/mobile the editor selection
 * often lives in the DOM only (no editor focus), so we map it back into the
 * ProseMirror state before acting. The ProseMirror state stays authoritative if
 * the DOM selection is stale or outside the editor.
 *
 * @param {import('@tiptap/core').Editor} editor
 */
export function syncSelectionFromDom(editor) {
  const selection = window.getSelection?.()
  const anchorNode = selection?.anchorNode
  const focusNode = selection?.focusNode
  if (!editor || !selection || selection.rangeCount === 0 || !anchorNode || !focusNode) return

  const view = getMountedEditorView(editor)
  if (!view) return
  const root = view.dom
  const anchorElement =
    anchorNode.nodeType === Node.ELEMENT_NODE ? anchorNode : anchorNode.parentElement
  const focusElement =
    focusNode.nodeType === Node.ELEMENT_NODE ? focusNode : focusNode.parentElement
  if (!anchorElement || !focusElement) return
  if (!root.contains(anchorElement) || !root.contains(focusElement)) return

  try {
    const anchorPos = view.posAtDOM(anchorNode, selection.anchorOffset)
    const headPos = view.posAtDOM(focusNode, selection.focusOffset)
    const nextSelection = TextSelection.create(editor.state.doc, anchorPos, headPos)
    if (!nextSelection.eq(editor.state.selection)) {
      view.dispatch(editor.state.tr.setSelection(nextSelection))
    }
  } catch {
    // Ignore stale DOM selections; the ProseMirror state remains authoritative.
  }
}

/**
 * True when the mark is present on the toggle target: the word under a collapsed
 * caret, or the current non-empty selection. Mirrors applyMarkToTarget's
 * targeting so the toggle decision matches the action — instead of relying on
 * caret-adjacency marks (isActive), which inclusive:false marks get wrong at
 * word edges.
 *
 * @param {import('@tiptap/pm/state').EditorState} state
 * @param {import('@tiptap/pm/model').MarkType} markType
 * @returns {boolean}
 */
export const isMarkActiveForToggle = (state, markType) => {
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

/**
 * Apply (or remove) a mark on the word under a collapsed caret, or on the
 * current selection. The caret stays collapsed — we never setTextSelection, so
 * no blue overlay flashes over the formatted word.
 *
 * Returns false (without acting) when there is no word/selection target — a
 * caret on whitespace or an empty block — so callers can fall back to the
 * standard stored-mark command ("format the next typed characters").
 *
 * @param {import('@tiptap/core').Editor} editor
 * @param {import('@tiptap/pm/model').MarkType} markType
 * @param {{ attrs?: object | null, remove?: boolean }} [options]
 * @returns {boolean} true when a word/selection target was acted on
 */
export function applyMarkToTarget(editor, markType, { attrs = null, remove = false } = {}) {
  if (!editor || !markType) return false
  syncSelectionFromDom(editor)

  const { selection } = editor.state
  let range = null
  if (selection.empty) {
    range = getWordRangeAt(editor.state)
    if (!range) return false // whitespace caret: let the caller fall back
  } else {
    range = { from: selection.from, to: selection.to }
  }

  editor
    .chain()
    .focus()
    .command(({ tr, dispatch }) => {
      if (dispatch) {
        tr.removeMark(range.from, range.to, markType)
        if (!remove) tr.addMark(range.from, range.to, markType.create(attrs))
      }
      return true
    })
    .run()

  return true
}
