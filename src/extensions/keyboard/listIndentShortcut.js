import { Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { Fragment } from '@tiptap/pm/model'

export const ListIndentShortcut = Extension.create({
  name: 'listIndentShortcut',
  priority: 1000,
  addKeyboardShortcuts() {
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

    const indentWithoutChildren = (itemTypeName) => {
      const { state, view } = this.editor
      const { selection } = state
      const { $from } = selection
      if (!$from) return false

      const itemType = state.schema.nodes[itemTypeName]
      if (!itemType) return false
      if (!selection.empty) {
        return this.editor.chain().focus().sinkListItem(itemTypeName).run()
      }

      let itemDepth = null
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        if ($from.node(depth).type === itemType) {
          itemDepth = depth
          break
        }
      }
      if (!itemDepth) return false

      const listDepth = itemDepth - 1
      if (listDepth <= 0) return false

      const listNode = $from.node(listDepth)
      const listType = listNode.type
      const index = $from.index(listDepth)
      if (index === 0) return false

      const listItemNode = $from.node(itemDepth)
      const listItemPos = $from.before(itemDepth)
      const listPos = $from.before(listDepth)

      const childListInfo = findChildList(listItemNode, listType)
      if (!childListInfo) {
        return this.editor.chain().focus().sinkListItem(itemTypeName).run()
      }

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
      view.dispatch(tr.scrollIntoView())
      view.focus()
      return true
    }

    const indent = () => {
      if (this.editor.isActive('taskList') || this.editor.isActive('taskItem')) {
        return indentWithoutChildren('taskItem')
      }
      if (
        this.editor.isActive('bulletList') ||
        this.editor.isActive('orderedList') ||
        this.editor.isActive('listItem')
      ) {
        return indentWithoutChildren('listItem')
      }
      return false
    }

    return {
      Tab: () => indent(),
    }
  },
})
