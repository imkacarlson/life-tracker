import { Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { CellSelection, TableMap } from '@tiptap/pm/tables'

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
