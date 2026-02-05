import { Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { Fragment } from '@tiptap/pm/model'
import { CellSelection, TableMap } from '@tiptap/pm/tables'

export const LinkShortcut = Extension.create({
  name: 'linkShortcut',
  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        const previous = this.editor.getAttributes('link')?.href ?? ''
        const nextUrl = window.prompt('Enter link URL', previous)
        if (nextUrl === null) return true
        const trimmed = nextUrl.trim()
        if (!trimmed) {
          this.editor.chain().focus().unsetLink().run()
          return true
        }
        const href =
          /^https?:\/\//i.test(trimmed) || trimmed.startsWith('#') ? trimmed : `https://${trimmed}`
        this.editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
        return true
      },
      'Mod--': () => {
        const { state, view } = this.editor
        const { from, to } = state.selection
        this.editor.chain().focus().toggleStrike().run()
        const nextState = this.editor.state
        const maxPos = nextState.doc.content.size
        const safeFrom = Math.min(from, maxPos)
        const safeTo = Math.min(to, maxPos)
        const selection = TextSelection.create(nextState.doc, safeFrom, safeTo)
        view.dispatch(nextState.tr.setSelection(selection))
        view.focus()
        return true
      },
      'Mod-.': () => {
        this.editor.chain().focus().toggleBulletList().run()
        return true
      },
      'Mod-Alt-h': () => {
        const isHighlighted = this.editor.isActive('highlight')
        if (isHighlighted) {
          this.editor.chain().focus().unsetHighlight().run()
          return true
        }
        const storedColor = this.editor.storage?.highlightColor
        if (storedColor === null) {
          return true
        }
        const currentColor =
          storedColor || this.editor.getAttributes('highlight')?.color || '#fef08a'
        this.editor.chain().focus().setHighlight({ color: currentColor }).run()
        return true
      },
    }
  },
})

export const BoldShortcut = Extension.create({
  name: 'boldShortcut',
  addKeyboardShortcuts() {
    return {
      'Mod-b': () => this.editor.chain().focus().toggleBold().run(),
    }
  },
})

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

export const ListSelectShortcut = Extension.create({
  name: 'listSelectShortcut',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      'Mod-a': () => {
        const { state, view } = this.editor
        const { $from } = state.selection
        const findAncestor = (names) => {
          for (let depth = $from.depth; depth > 0; depth -= 1) {
            const node = $from.node(depth)
            if (names.includes(node.type?.name)) {
              return { node, pos: $from.before(depth) }
            }
          }
          return null
        }

        const selectionCovers = (from, to) =>
          state.selection.from <= from && state.selection.to >= to

        const selectRange = (from, to) => {
          const selection = TextSelection.create(state.doc, from, to)
          view.dispatch(state.tr.setSelection(selection))
          view.focus()
          return true
        }

        const selectCell = (pos) => {
          const selection = CellSelection.create(state.doc, pos)
          view.dispatch(state.tr.setSelection(selection))
          view.focus()
          return true
        }

        const selectTable = (table) => {
          const map = TableMap.get(table.node)
          const tableStart = table.pos + 1
          const firstCellPos = tableStart + map.map[0]
          const lastCellPos = tableStart + map.map[map.map.length - 1]
          const selection = CellSelection.create(state.doc, firstCellPos, lastCellPos)
          view.dispatch(state.tr.setSelection(selection))
          view.focus()
          return true
        }

        const isFullTableSelection = (table) => {
          if (!(state.selection instanceof CellSelection)) return false
          const map = TableMap.get(table.node)
          const tableStart = table.pos + 1
          const firstCellPos = tableStart + map.map[0]
          const lastCellPos = tableStart + map.map[map.map.length - 1]
          const anchorPos = state.selection.$anchorCell?.pos
          const headPos = state.selection.$headCell?.pos
          return (
            (anchorPos === firstCellPos && headPos === lastCellPos) ||
            (anchorPos === lastCellPos && headPos === firstCellPos)
          )
        }

        const list = findAncestor(['listItem', 'taskItem'])
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
          if (!selectionCovers(listFrom, listTo)) {
            return selectRange(listFrom, listTo)
          }
        }

        const textBlock = findAncestor(['paragraph', 'heading'])
        if (!list && textBlock) {
          const blockFrom = textBlock.pos + 1
          const blockTo = textBlock.pos + textBlock.node.nodeSize - 1
          if (!selectionCovers(blockFrom, blockTo)) {
            return selectRange(blockFrom, blockTo)
          }
        }

        const cell = findAncestor(['tableCell', 'tableHeader'])
        if (cell) {
          if (!(state.selection instanceof CellSelection) || state.selection.$anchorCell?.pos !== cell.pos) {
            return selectCell(cell.pos)
          }
          const table = findAncestor(['table'])
          if (table && !isFullTableSelection(table)) {
            return selectTable(table)
          }
        }

        if (list || cell || textBlock) {
          this.editor.commands.selectAll()
          return true
        }

        return false
      },
    }
  },
})

export const ListExitOnEmpty = Extension.create({
  name: 'listExitOnEmpty',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state } = this.editor
        if (!state.selection.empty) return false
        const { $from } = state.selection

        for (let depth = $from.depth; depth > 0; depth -= 1) {
          const node = $from.node(depth)
          if (node.type?.name !== 'listItem' && node.type?.name !== 'taskItem') continue
          const firstChild = node.childCount > 0 ? node.child(0) : null
          if (!firstChild || firstChild.type?.name !== 'paragraph') return false
          if ((firstChild.textContent || '').trim().length > 0) return false
          return this.editor.chain().focus().liftListItem(node.type.name).run()
        }

        return false
      },
    }
  },
})

export const ListEnterOutdent = Extension.create({
  name: 'listEnterOutdent',
  priority: 1100,
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state } = this.editor
        const { selection } = state
        if (!selection.empty) return false
        const { $from } = selection
        if (!$from || $from.parentOffset !== 0) return false

        let itemDepth = null
        let itemTypeName = null
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          const node = $from.node(depth)
          if (node.type?.name === 'listItem' || node.type?.name === 'taskItem') {
            itemDepth = depth
            itemTypeName = node.type.name
            break
          }
        }
        if (!itemDepth || !itemTypeName) return false

        const itemNode = $from.node(itemDepth)
        const firstChild = itemNode.childCount > 0 ? itemNode.child(0) : null
        if (!firstChild || !firstChild.isTextblock) return false
        if ((firstChild.textContent || '').trim().length > 0) return false
        if ($from.depth < itemDepth + 1) return false
        if ($from.node(itemDepth + 1) !== firstChild) return false

        return this.editor.chain().focus().liftListItem(itemTypeName).run()
      },
    }
  },
})

export const ListBackspaceOutdent = Extension.create({
  name: 'listBackspaceOutdent',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { state } = this.editor
        const { selection } = state
        if (!selection.empty) return false
        const { $from } = selection
        if (!$from || $from.parentOffset !== 0) return false

        let itemDepth = null
        let itemTypeName = null
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          const node = $from.node(depth)
          if (node.type?.name === 'listItem' || node.type?.name === 'taskItem') {
            itemDepth = depth
            itemTypeName = node.type.name
            break
          }
        }
        if (!itemDepth || !itemTypeName) return false

        const itemNode = $from.node(itemDepth)
        const firstChild = itemNode.childCount > 0 ? itemNode.child(0) : null
        if (!firstChild || !firstChild.isTextblock) return false
        if ($from.depth < itemDepth + 1) return false
        if ($from.node(itemDepth + 1) !== firstChild) return false

        const listDepth = itemDepth - 1
        const listParentDepth = listDepth - 1
        if (listParentDepth <= 0) return false
        const listParent = $from.node(listParentDepth)
        if (listParent.type?.name !== 'listItem' && listParent.type?.name !== 'taskItem') {
          return false
        }

        return this.editor.chain().focus().liftListItem(itemTypeName).run()
      },
    }
  },
})
