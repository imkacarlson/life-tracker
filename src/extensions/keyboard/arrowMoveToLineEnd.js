import { Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

export const ArrowMoveToLineEnd = Extension.create({
  name: 'arrowMoveToLineEnd',
  priority: 1000,
  addKeyboardShortcuts() {
    const findAncestor = ($pos, names) => {
      for (let depth = $pos.depth; depth > 0; depth -= 1) {
        const node = $pos.node(depth)
        if (names.includes(node.type?.name)) {
          return { node, depth, pos: $pos.before(depth) }
        }
      }
      return null
    }

    const countTextblocks = (node) => {
      let count = 0
      node.forEach((child) => {
        if (child.isTextblock) count += 1
      })
      return count
    }

    const findFirstTextblock = (node) => {
      let offset = 0
      for (let i = 0; i < node.childCount; i += 1) {
        const child = node.child(i)
        if (child.isTextblock) {
          return { node: child, offset }
        }
        offset += child.nodeSize
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

    const moveInList = (direction) => {
      const { state, view } = this.editor
      const { selection } = state
      if (!selection.empty) return false
      const { $from } = selection
      if (!$from?.parent?.isTextblock) return false
      if ($from.parentOffset !== $from.parent.content.size) return false

      const listItem = findAncestor($from, ['listItem', 'taskItem'])
      if (!listItem) return false
      if (countTextblocks(listItem.node) > 1) return false

      const listDepth = listItem.depth - 1
      if (listDepth <= 0) return false
      const listNode = $from.node(listDepth)
      const index = $from.index(listDepth)
      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= listNode.childCount) return false

      const targetItem = listNode.child(nextIndex)
      if (!targetItem) return false
      const targetType = targetItem.type?.name
      if (targetType !== 'listItem' && targetType !== 'taskItem') return false
      if (countTextblocks(targetItem) > 1) return false

      const listPos = $from.before(listDepth)
      const targetOffset = offsetBeforeIndex(listNode, nextIndex)
      const targetItemPos = listPos + 1 + targetOffset
      const firstTextblock = findFirstTextblock(targetItem)
      if (!firstTextblock) return false

      const textblockPos = targetItemPos + 1 + firstTextblock.offset
      const selectionPos = textblockPos + firstTextblock.node.nodeSize - 1
      const tr = state.tr
        .setSelection(TextSelection.create(state.doc, selectionPos))
        .scrollIntoView()
      view.dispatch(tr)
      view.focus()
      return true
    }

    return {
      ArrowDown: () => moveInList(1),
      ArrowUp: () => moveInList(-1),
    }
  },
})
