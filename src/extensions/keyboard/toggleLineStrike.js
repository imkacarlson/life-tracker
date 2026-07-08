import { TextSelection } from '@tiptap/pm/state'
import { getBlockTextRange } from '../../utils/blockRange'
import { rangeFullyHasMark, syncSelectionFromDom } from '../../utils/smartMark'
import { getMountedEditorView } from '../../utils/editorView'

// Toggles strikethrough on the entire current line/block when the cursor has no
// selection, or on just the selected text when a range is already selected.
export const toggleLineStrike = (editor) => {
  syncSelectionFromDom(editor)

  const view = getMountedEditorView(editor)
  if (!view) return
  const { state } = editor
  const { from, to, empty } = state.selection

  if (!empty) {
    // User has text selected — toggle strike on that selection only
    editor.chain().focus().toggleStrike().run()
    // Restore selection position (doc size may not change for mark toggles, but be safe)
    const next = editor.state
    const maxPos = next.doc.content.size
    const sel = TextSelection.create(next.doc, Math.min(from, maxPos), Math.min(to, maxPos))
    view.dispatch(next.tr.setSelection(sel))
    return
  }

  // Cursor with no selection: toggle the entire block text range without
  // creating a visible native selection. This keeps mobile formatting stable
  // when the line already contains other marks like bold.
  const range = getBlockTextRange(state)
  if (!range || range.from >= range.to) {
    // Empty block or couldn't resolve — fall back to default toggle
    editor.chain().focus().toggleStrike().run()
    return
  }

  const markType = state.schema.marks.strike
  const remove = rangeFullyHasMark(state, range.from, range.to, markType)
  const tr = state.tr.removeMark(range.from, range.to, markType)
  if (!remove) tr.addMark(range.from, range.to, markType.create())
  view.dispatch(tr)

  const next = editor.state
  const cursorPos = Math.min(from, next.doc.content.size)
  view.dispatch(next.tr.setSelection(TextSelection.create(next.doc, cursorPos)))
  view.focus()
}
