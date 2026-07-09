import { TextSelection } from '@tiptap/pm/state'
import { getBlockTextRange } from '../../utils/blockRange'
import { syncSelectionFromDom } from '../../utils/smartMark'
import { getMountedEditorView } from '../../utils/editorView'

// Clears all inline formatting (bold, italic, underline, strike, highlight,
// text color, code, links) from the entire current line/block when the cursor
// has no selection, or from just the selected text when a range is selected.
// Block-level structure (headings, lists, alignment) is intentionally left
// untouched.
export const clearLineFormatting = (editor) => {
  syncSelectionFromDom(editor)

  const view = getMountedEditorView(editor)
  if (!view) return
  const { state } = editor
  const { from, to, empty } = state.selection

  if (!empty) {
    // User has text selected — clear inline marks on that selection only
    editor.chain().focus().unsetAllMarks().run()
    // Restore selection position (doc size doesn't change for mark removal,
    // but clamp to be safe)
    const next = editor.state
    const maxPos = next.doc.content.size
    const sel = TextSelection.create(next.doc, Math.min(from, maxPos), Math.min(to, maxPos))
    view.dispatch(next.tr.setSelection(sel))
    return
  }

  // Cursor with no selection: clear the entire block text range without
  // creating a visible native selection. Passing no mark to removeMark strips
  // ALL inline marks in the range — exactly "clear inline formatting".
  const range = getBlockTextRange(state)
  if (!range || range.from >= range.to) {
    // Empty line — nothing to clear
    return
  }

  view.dispatch(state.tr.removeMark(range.from, range.to))

  const next = editor.state
  const cursorPos = Math.min(from, next.doc.content.size)
  view.dispatch(next.tr.setSelection(TextSelection.create(next.doc, cursorPos)))
  view.focus()
}
