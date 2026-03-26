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
