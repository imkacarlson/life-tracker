import { TextSelection } from '@tiptap/pm/state'

// While a deep-link landing is "armed", this class lives on the ProseMirror root
// so CSS can hide the native blue selection (the yellow box stays as the visual).
export const DEEP_LINK_SELECTION_ACTIVE_CLASS = 'deep-link-selection-active'

/**
 * Find the content text range of the block whose attrs.id === blockId.
 *
 * Textblocks (paragraph/heading) span pos+1 .. pos+nodeSize-1; container blocks
 * (bulletList/orderedList/taskList/table) span their inner content the same way.
 * Endpoints are snapped to valid text positions via TextSelection.between, which
 * also collapses empty blocks correctly.
 *
 * @returns {{ from: number, to: number } | null}
 */
export const findBlockRangeById = (state, blockId) => {
  if (!state || !blockId) return null
  const { doc } = state

  let found = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (node.attrs?.id === blockId) {
      found = { node, pos }
      return false
    }
    return true
  })
  if (!found) return null

  const docSize = doc.content.size
  const rawFrom = Math.min(Math.max(found.pos + 1, 0), docSize)
  const rawTo = Math.min(Math.max(found.pos + found.node.nodeSize - 1, rawFrom), docSize)

  const selection = TextSelection.between(doc.resolve(rawFrom), doc.resolve(rawTo))
  return { from: selection.from, to: selection.to }
}

/**
 * Give the editor a real ProseMirror TextSelection spanning the target block, so
 * every toolbar command, copy/paste, and shortcut operates on it as if the user
 * had selected the line with the mouse. Selection-only transaction → does not
 * mark the doc dirty, so autosave is untouched. Focus only when requested (desktop).
 *
 * @returns {boolean} whether a selection was applied
 */
export const applyDeepLinkSelection = (editor, blockId, { focus = false } = {}) => {
  if (!editor || editor.isDestroyed) return false
  const { state, view } = editor

  const range = findBlockRangeById(state, blockId)
  if (!range) return false

  const selection = TextSelection.create(state.doc, range.from, range.to)
  const tr = state.tr.setSelection(selection)
  tr.setMeta('addToHistory', false)
  view.dispatch(tr)

  view.dom.classList.add(DEEP_LINK_SELECTION_ACTIVE_CLASS)

  if (focus) {
    view.focus()
  }
  return true
}
