import { TextSelection } from '@tiptap/pm/state'

const findAncestor = ($from, names) => {
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (names.includes(node.type?.name)) {
      return { node, pos: $from.before(depth) }
    }
  }
  return null
}

const selectionCovers = (selection, from, to) => selection.from <= from && selection.to >= to

const selectRange = (state, view, from, to) => {
  const nextSelection = TextSelection.create(state.doc, from, to)
  view.dispatch(state.tr.setSelection(nextSelection))
  view.focus()
  return true
}

// Returns { from, to } for the text range of the current block without mutating selection.
export const getBlockTextRange = (state) => {
  const { $from } = state.selection

  const list = findAncestor($from, ['listItem', 'taskItem'])
  if (list) {
    let paragraphPos = null
    let paragraphSize = null
    list.node.content?.forEach((child, offset) => {
      if (paragraphPos !== null) return
      if (child.type?.name === 'paragraph') {
        paragraphPos = list.pos + 1 + offset
        paragraphSize = child.nodeSize
      }
    })

    const blockFrom = paragraphPos !== null ? paragraphPos + 1 : list.pos + 1
    const blockTo =
      paragraphPos !== null && paragraphSize
        ? paragraphPos + paragraphSize - 1
        : list.pos + list.node.nodeSize - 1

    return { from: blockFrom, to: blockTo }
  }

  const textBlock = findAncestor($from, ['paragraph', 'heading'])
  if (!textBlock) return null

  return { from: textBlock.pos + 1, to: textBlock.pos + textBlock.node.nodeSize - 1 }
}

export const expandSelectionToBlock = (editor) => {
  const { state, view } = editor
  const { from, to } = state.selection

  const range = getBlockTextRange(state)
  if (!range) return false

  if (selectionCovers(state.selection, range.from, range.to)) return false

  return selectRange(state, view, range.from, range.to)
}
