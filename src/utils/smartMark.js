// Shared, mark-agnostic helpers for collapsed-caret formatting. Highlight uses
// the word-level target; the regular inline tools use the block-level target.
// Both paths avoid moving the visible selection, so no native blue overlay
// flashes over formatted text.

import { TextSelection } from '@tiptap/pm/state'
import { getBlockTextRange } from './blockRange'
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

export const rangeFullyHasMark = (state, from, to, markType) => {
  if (!state || !markType || from >= to) return false

  let sawText = false
  let fullyMarked = true

  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!fullyMarked) return false
    if (!node.isText) return true

    const textFrom = Math.max(from, pos)
    const textTo = Math.min(to, pos + node.nodeSize)
    if (textFrom >= textTo) return false

    sawText = true
    if (!markType.isInSet(node.marks)) {
      fullyMarked = false
      return false
    }

    return false
  })

  return sawText && fullyMarked
}

/**
 * True when the mark fully covers the toggle target: the word under a collapsed
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
    if (range) return rangeFullyHasMark(state, range.from, range.to, markType)
    // Caret on whitespace / empty block: fall back to stored/adjacent marks.
    const marks = state.storedMarks || selection.$from.marks()
    return marks.some((m) => m.type === markType)
  }

  return rangeFullyHasMark(state, selection.from, selection.to, markType)
}

/**
 * True when the mark fully covers the block-level toggle target: the current
 * paragraph/list item under a collapsed caret, or the current non-empty
 * selection.
 *
 * @param {import('@tiptap/pm/state').EditorState} state
 * @param {import('@tiptap/pm/model').MarkType} markType
 * @returns {boolean}
 */
export const isMarkActiveForBlockToggle = (state, markType) => {
  if (!state || !markType) return false
  const { selection } = state

  if (selection.empty) {
    const range = getBlockTextRange(state)
    if (range && range.from < range.to) {
      return rangeFullyHasMark(state, range.from, range.to, markType)
    }
    const marks = state.storedMarks || selection.$from.marks()
    return marks.some((m) => m.type === markType)
  }

  return rangeFullyHasMark(state, selection.from, selection.to, markType)
}

// Resolve the target range for a smart mark action. With a non-empty selection
// we act on the selection. With a collapsed caret we grab the smart target: the
// word under the cursor (level 'word') or the whole paragraph/list item (level
// 'block'). Returns null when the caret sits on whitespace / an empty block —
// there is nothing to grab, so the caller only arms continued typing.
function resolveSmartRange(state, level) {
  const { selection } = state
  if (!selection.empty) {
    return { from: selection.from, to: selection.to }
  }
  const range = level === 'word' ? getWordRangeAt(state) : getBlockTextRange(state)
  if (!range || range.from >= range.to) return null
  return range
}

/**
 * Apply (or remove) a mark the way the toolbar buttons do, in one transaction:
 *
 *  - Cursor in a word/line (collapsed caret) → format the smart target (word for
 *    'word', whole block for 'block') AND arm continued typing so newly typed
 *    text keeps the format.
 *  - Cursor on whitespace / empty block (nothing to grab) → just arm the next
 *    typed characters.
 *  - Text selected → format the selection (no arming).
 *
 * The caret stays collapsed — we never setTextSelection, so no native blue
 * overlay flashes over the formatted text.
 *
 * @param {import('@tiptap/core').Editor} editor
 * @param {import('@tiptap/pm/model').MarkType} markType
 * @param {{ attrs?: object | null, level?: 'word' | 'block', remove?: boolean }} [options]
 */
export function applyMarkSmart(editor, markType, { attrs = null, level = 'block', remove = false } = {}) {
  if (!editor || !markType) return
  syncSelectionFromDom(editor)

  const range = resolveSmartRange(editor.state, level)

  editor
    .chain()
    .focus()
    .command(({ state, tr, dispatch }) => {
      if (!dispatch) return true
      const mark = markType.create(attrs)

      if (range) {
        tr.removeMark(range.from, range.to, markType)
        if (!remove) tr.addMark(range.from, range.to, mark)
      }

      // Collapsed caret: arm continued typing so the next characters match.
      if (state.selection.empty) {
        if (remove) tr.removeStoredMark(markType)
        else tr.addStoredMark(mark)
      }

      return true
    })
    .run()
}

/**
 * Toggle a mark on the smart target. Reads the current active state via the
 * matching active-state helper (word- or block-level) so the toggle decision
 * mirrors the action, then delegates to applyMarkSmart. Shared by the
 * bold/italic/underline toolbar buttons and their keyboard shortcuts.
 *
 * @param {import('@tiptap/core').Editor} editor
 * @param {import('@tiptap/pm/model').MarkType} markType
 * @param {{ level?: 'word' | 'block' }} [options]
 */
export function toggleMarkSmart(editor, markType, { level = 'block' } = {}) {
  if (!editor || !markType) return
  syncSelectionFromDom(editor)
  const isActive =
    level === 'word'
      ? isMarkActiveForToggle(editor.state, markType)
      : isMarkActiveForBlockToggle(editor.state, markType)
  applyMarkSmart(editor, markType, { level, remove: isActive })
}
