import { TextSelection } from '@tiptap/pm/state'
import { getBlockTextRange } from '../../utils/blockRange'

const selectionCovers = (selection, from, to) => selection.from <= from && selection.to >= to

const selectRange = (state, view, from, to) => {
  const nextSelection = TextSelection.create(state.doc, from, to)
  view.dispatch(state.tr.setSelection(nextSelection))
  view.focus()
  return true
}

export const expandSelectionToBlock = (editor) => {
  const { state, view } = editor

  const range = getBlockTextRange(state)
  if (!range) return false

  if (selectionCovers(state.selection, range.from, range.to)) return false

  return selectRange(state, view, range.from, range.to)
}
