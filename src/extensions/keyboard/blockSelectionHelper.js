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

export const expandSelectionToBlock = (editor) => {
  const { state, view } = editor
  const { $from, from, to } = state.selection

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

    const listFrom = paragraphPos !== null ? paragraphPos + 1 : list.pos + 1
    const listTo =
      paragraphPos !== null && paragraphSize
        ? paragraphPos + paragraphSize - 1
        : list.pos + list.node.nodeSize - 1

    if (!(from <= listFrom && to >= listTo)) {
      return selectRange(state, view, listFrom, listTo)
    }
    return false
  }

  const textBlock = findAncestor($from, ['paragraph', 'heading'])
  if (!textBlock) return false

  const blockFrom = textBlock.pos + 1
  const blockTo = textBlock.pos + textBlock.node.nodeSize - 1
  if (selectionCovers(state.selection, blockFrom, blockTo)) return false

  return selectRange(state, view, blockFrom, blockTo)
}
