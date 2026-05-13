/**
 * Count the nesting depth of list wrappers at a given document position.
 * Returns 0 for positions outside any list.
 *
 * Extracted from useEditorSetup so it can be unit-tested with a real
 * ProseMirror EditorState (no DOM/React required).
 */
export const getListDepthAt = (state, pos) => {
  const $pos = state.doc.resolve(pos)
  let depth = 0
  for (let d = $pos.depth; d > 0; d -= 1) {
    const name = $pos.node(d).type?.name
    if (name === 'bulletList' || name === 'orderedList' || name === 'taskList') {
      depth += 1
    }
  }
  return depth
}

/**
 * Return 'taskItem', 'listItem', or null for the list item type at a given
 * document position.
 */
export const getListItemTypeAt = (state, pos) => {
  const $pos = state.doc.resolve(pos)
  for (let d = $pos.depth; d > 0; d -= 1) {
    const name = $pos.node(d).type?.name
    if (name === 'taskItem') return 'taskItem'
    if (name === 'listItem') return 'listItem'
  }
  return null
}

/**
 * Describe the list item enclosing the current selection for indent/outdent
 * decisions on mobile. Returns null when the selection is not inside any list.
 *
 * Fields:
 *   - itemTypeName: 'taskItem' or 'listItem' — the chain command to invoke
 *   - itemDepth:    ProseMirror depth of the listItem/taskItem node
 *   - listDepth:    depth of the enclosing list (one less than itemDepth)
 *   - index:        index of this item within its list (0 disallows sink)
 *   - isNested:     true when the list itself is inside another list item
 *                   (only nested items can be lifted)
 */
export const getListItemInfo = (editor) => {
  if (!editor) return null
  const { $from } = editor.state.selection
  const itemTypeName = editor.isActive('taskList') || editor.isActive('taskItem')
    ? 'taskItem'
    : 'listItem'
  let itemDepth = null
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type?.name === 'listItem' || node.type?.name === 'taskItem') {
      itemDepth = depth
      break
    }
  }
  if (!itemDepth) return null
  const listDepth = itemDepth - 1
  const index = $from.index(listDepth)
  const listParentDepth = listDepth - 1
  const listParent = listParentDepth > 0 ? $from.node(listParentDepth) : null
  const isNested = listParent?.type?.name === 'listItem' || listParent?.type?.name === 'taskItem'
  return { itemTypeName, itemDepth, listDepth, index, isNested }
}
