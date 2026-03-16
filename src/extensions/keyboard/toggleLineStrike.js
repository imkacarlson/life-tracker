import { TextSelection } from '@tiptap/pm/state'
import { getBlockTextRange } from './blockSelectionHelper'

// Toggles strikethrough on the entire current line/block when the cursor has no
// selection, or on just the selected text when a range is already selected.
export const toggleLineStrike = (editor) => {
  const { state, view } = editor
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

  // Cursor with no selection — expand to entire block text range
  const range = getBlockTextRange(state)
  if (!range || range.from >= range.to) {
    // Empty block or couldn't resolve — fall back to default toggle
    editor.chain().focus().toggleStrike().run()
    return
  }

  // Select the full block text, toggle strike, then collapse cursor back
  const sel = TextSelection.create(state.doc, range.from, range.to)
  view.dispatch(state.tr.setSelection(sel))

  editor.chain().toggleStrike().run()

  // Restore cursor to original position
  const next = editor.state
  const maxPos = next.doc.content.size
  const cursorPos = Math.min(from, maxPos)
  const restored = TextSelection.create(next.doc, cursorPos)
  view.dispatch(next.tr.setSelection(restored))
  view.focus()
}
