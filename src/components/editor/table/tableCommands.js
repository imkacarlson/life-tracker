import { TableMap } from '@tiptap/pm/tables'
import { getMountedEditorView } from '../../../utils/editorView'

export function buildTableCommands({ editor, editorCmd }) {
  const getActiveCellColor = () => {
    if (!editor) return null
    return (
      editor.getAttributes('tableCell')?.backgroundColor ??
      editor.getAttributes('tableHeader')?.backgroundColor ??
      null
    )
  }

  const getTableContext = () => {
    if (!editor) return null
    const { state } = editor
    const { $from } = state.selection
    let tableDepth = null
    let cellDepth = null
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const nodeName = $from.node(depth).type.name
      if (cellDepth === null && (nodeName === 'tableCell' || nodeName === 'tableHeader')) {
        cellDepth = depth
      }
      if (nodeName === 'table') {
        tableDepth = depth
        break
      }
    }
    if (tableDepth === null || cellDepth === null) return null
    const tableNode = $from.node(tableDepth)
    const tablePos = $from.before(tableDepth)
    const tableStart = $from.start(tableDepth)
    const cellPos = $from.before(cellDepth)
    const map = TableMap.get(tableNode)
    const cellPosRel = cellPos - tableStart
    const cellRect = map.findCell(cellPosRel)
    return { tablePos, cellRect }
  }

  const applyColorToRow = (tablePos, rowIndex, color) => {
    const view = getMountedEditorView(editor)
    if (!view) return
    const { state } = editor
    const tableNode = state.doc.nodeAt(tablePos)
    if (!tableNode) return
    const map = TableMap.get(tableNode)
    if (rowIndex < 0 || rowIndex >= map.height) return
    const tableStart = tablePos + 1
    const tr = state.tr
    const seen = new Set()
    for (let col = 0; col < map.width; col += 1) {
      const cellPos = map.map[rowIndex * map.width + col]
      if (cellPos == null || seen.has(cellPos)) continue
      seen.add(cellPos)
      const cell = tableNode.nodeAt(cellPos)
      if (!cell) continue
      tr.setNodeMarkup(tableStart + cellPos, undefined, {
        ...cell.attrs,
        backgroundColor: color,
      })
    }
    if (tr.docChanged) view.dispatch(tr)
  }

  const applyColorToColumn = (tablePos, colIndex, color) => {
    const view = getMountedEditorView(editor)
    if (!view) return
    const { state } = editor
    const tableNode = state.doc.nodeAt(tablePos)
    if (!tableNode) return
    const map = TableMap.get(tableNode)
    if (colIndex < 0 || colIndex >= map.width) return
    const tableStart = tablePos + 1
    const tr = state.tr
    const seen = new Set()
    for (let row = 0; row < map.height; row += 1) {
      const cellPos = map.map[row * map.width + colIndex]
      if (cellPos == null || seen.has(cellPos)) continue
      seen.add(cellPos)
      const cell = tableNode.nodeAt(cellPos)
      if (!cell) continue
      tr.setNodeMarkup(tableStart + cellPos, undefined, {
        ...cell.attrs,
        backgroundColor: color,
      })
    }
    if (tr.docChanged) view.dispatch(tr)
  }

  const handleInsertRow = (after) => {
    if (!editor) return
    const color = getActiveCellColor()
    const tableContext = getTableContext()
    const rowIndex = tableContext
      ? after
        ? tableContext.cellRect.bottom
        : tableContext.cellRect.top
      : null
    if (after) editorCmd()?.addRowAfter().run()
    else editorCmd()?.addRowBefore().run()
    if (color && tableContext && rowIndex !== null) {
      applyColorToRow(tableContext.tablePos, rowIndex, color)
    }
  }

  const handleInsertColumn = (after) => {
    if (!editor) return
    const color = getActiveCellColor()
    const tableContext = getTableContext()
    const colIndex = tableContext
      ? after
        ? tableContext.cellRect.right
        : tableContext.cellRect.left
      : null
    if (after) editorCmd()?.addColumnAfter().run()
    else editorCmd()?.addColumnBefore().run()
    if (color && tableContext && colIndex !== null) {
      applyColorToColumn(tableContext.tablePos, colIndex, color)
    }
  }

  return [
    { label: 'Insert row above', action: () => handleInsertRow(false) },
    { label: 'Insert row below', action: () => handleInsertRow(true) },
    { label: 'Insert column left', action: () => handleInsertColumn(false) },
    { label: 'Insert column right', action: () => handleInsertColumn(true) },
    { label: 'Delete row', action: () => editorCmd()?.deleteRow().run() },
    { label: 'Delete column', action: () => editorCmd()?.deleteColumn().run() },
    { label: 'Delete table', action: () => editorCmd()?.deleteTable().run() },
  ]
}
