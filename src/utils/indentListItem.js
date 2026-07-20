import { TextSelection } from '@tiptap/pm/state'
import { Fragment } from '@tiptap/pm/model'

// Shared "indent a list item WITHOUT dragging its own nested children deeper".
//
// Plain ProseMirror `sinkListItem` nests the whole item — including any child
// list — one level down, so the item's sub-items visually indent too. That is
// almost never what the user wants: they want just the current item to move
// under the previous sibling, while its existing children stay at their level.
//
// This module builds that transaction. It is used by both the Tab keyboard
// shortcut and the mobile toolbar Indent button so the behavior is identical
// no matter how the indent is triggered.

const findChildList = (node, listType) => {
  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i)
    if (child.type === listType) {
      return { node: child, index: i }
    }
  }
  return null
}

const offsetBeforeIndex = (node, index) => {
  let offset = 0
  for (let i = 0; i < index; i += 1) {
    offset += node.child(i).nodeSize
  }
  return offset
}

/**
 * Build the transaction that indents the current list item without pulling its
 * own child list deeper. Pure over the given EditorState (no dispatch/focus),
 * so it can be unit-tested with a real ProseMirror state.
 *
 * Returns one of:
 *   - null              → selection is not in an indentable item (do nothing)
 *   - { fallback: true } → caller should run plain sinkListItem (no children to
 *                          strip, or a non-collapsed selection)
 *   - { tr }            → a ready-to-dispatch transaction (selection already set)
 */
export const buildIndentWithoutChildrenTransaction = (state, itemTypeName) => {
  const { selection } = state
  const { $from } = selection
  if (!$from) return null

  const itemType = state.schema.nodes[itemTypeName]
  if (!itemType) return null
  // A non-collapsed selection may span multiple items — defer to the built-in
  // sink command, which handles ranges.
  if (!selection.empty) return { fallback: true }

  let itemDepth = null
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type === itemType) {
      itemDepth = depth
      break
    }
  }
  if (!itemDepth) return null

  const listDepth = itemDepth - 1
  if (listDepth <= 0) return null

  const listNode = $from.node(listDepth)
  const listType = listNode.type
  const index = $from.index(listDepth)
  if (index === 0) return null

  const listItemNode = $from.node(itemDepth)
  const listItemPos = $from.before(itemDepth)
  const listPos = $from.before(listDepth)

  const childListInfo = findChildList(listItemNode, listType)
  // No nested child list on this item → nothing to strip, plain sink is correct.
  if (!childListInfo) return { fallback: true }

  const prevItemNode = listNode.child(index - 1)
  const prevListInfo = findChildList(prevItemNode, listType)

  const strippedChildren = []
  for (let i = 0; i < listItemNode.childCount; i += 1) {
    if (i === childListInfo.index) continue
    strippedChildren.push(listItemNode.child(i))
  }
  const movedItem = listItemNode.copy(Fragment.fromArray(strippedChildren))

  const movedItems = [movedItem]
  childListInfo.node.content.forEach((child) => movedItems.push(child))

  let newPrevList = null
  let prevListOffset = 0

  if (prevListInfo) {
    const mergedContent = prevListInfo.node.content.append(Fragment.fromArray(movedItems))
    newPrevList = prevListInfo.node.copy(mergedContent)
  } else {
    newPrevList = listType.create(null, Fragment.fromArray(movedItems))
  }

  const prevItemChildren = []
  let runningOffset = 0
  for (let i = 0; i < prevItemNode.childCount; i += 1) {
    if (prevListInfo && i === prevListInfo.index) {
      prevListOffset = runningOffset
      prevItemChildren.push(newPrevList)
      runningOffset += newPrevList.nodeSize
      continue
    }
    const child = prevItemNode.child(i)
    prevItemChildren.push(child)
    runningOffset += child.nodeSize
  }
  if (!prevListInfo) {
    prevListOffset = runningOffset
    prevItemChildren.push(newPrevList)
  }

  const newPrevItem = prevItemNode.copy(Fragment.fromArray(prevItemChildren))

  const listChildren = []
  let prevItemOffset = 0
  let listOffset = 0
  for (let i = 0; i < listNode.childCount; i += 1) {
    if (i === index - 1) {
      prevItemOffset = listOffset
      listChildren.push(newPrevItem)
      listOffset += newPrevItem.nodeSize
      continue
    }
    if (i === index) {
      continue
    }
    const child = listNode.child(i)
    listChildren.push(child)
    listOffset += child.nodeSize
  }

  const newListNode = listNode.copy(Fragment.fromArray(listChildren))
  const tr = state.tr.replaceWith(listPos, listPos + listNode.nodeSize, newListNode)

  const innerOffset = Math.max(0, selection.from - (listItemPos + 1))
  const clampedOffset = Math.min(innerOffset, movedItem.content.size)
  const movedIndex = prevListInfo ? prevListInfo.node.childCount : 0
  const movedOffset = offsetBeforeIndex(newPrevList, movedIndex)
  const prevItemPos = listPos + 1 + prevItemOffset
  const prevListPos = prevItemPos + 1 + prevListOffset
  const movedItemPos = prevListPos + 1 + movedOffset
  const selectionPos = movedItemPos + 1 + clampedOffset

  tr.setSelection(TextSelection.create(tr.doc, selectionPos))
  return { tr }
}

/**
 * Indent the current list item without dragging its own children deeper.
 * Dispatches on the editor's view and restores focus. Returns true when it
 * handled the indent (including the plain-sink fallback), false otherwise.
 */
export const indentListItemWithoutChildren = (editor, itemTypeName) => {
  if (!editor) return false
  const result = buildIndentWithoutChildrenTransaction(editor.state, itemTypeName)
  if (!result) return false
  if (result.fallback) {
    return editor.chain().focus().sinkListItem(itemTypeName).run()
  }
  editor.view.dispatch(result.tr.scrollIntoView())
  editor.view.focus()
  return true
}
