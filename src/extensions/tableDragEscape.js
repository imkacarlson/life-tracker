import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { CellSelection } from '@tiptap/pm/tables'

const tableDragEscapeKey = new PluginKey('tableDragEscape')

function isInTableCell($pos) {
  for (let d = $pos.depth; d > 0; d--) {
    const name = $pos.node(d).type.name
    if (name === 'tableCell' || name === 'tableHeader') return true
  }
  return false
}

// Walk up from a DOM element to find the containing TD/TH, stopping at the
// editor root.
function findCellDOM(dom, editorDOM) {
  while (dom && dom !== editorDOM) {
    if (dom.nodeName === 'TD' || dom.nodeName === 'TH') return dom
    dom = dom.parentNode
  }
  return null
}

// Given a resolved ProseMirror position, return the position of the closest
// ancestor tableCell/tableHeader node (i.e. the cell start position needed
// by CellSelection.create).
function cellPosFromResolved($pos) {
  for (let d = $pos.depth; d > 0; d--) {
    const name = $pos.node(d).type.name
    if (name === 'tableCell' || name === 'tableHeader') return $pos.before(d)
  }
  return null
}

const TableDragEscape = Extension.create({
  name: 'tableDragEscape',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: tableDragEscapeKey,
        props: {
          // When a TextSelection crosses a table boundary, apply selectedCell
          // decorations to the table cells so they stay visually highlighted
          // (the native browser ::selection renders poorly across tables).
          decorations(state) {
            const { selection } = state
            if (!(selection instanceof TextSelection)) return null

            const { $from, $to, from, to } = selection
            const fromInCell = isInTableCell($from)
            const toInCell = isInTableCell($to)

            // Only when selection crosses a table boundary
            if (fromInCell === toInCell) return null

            const decos = []
            state.doc.nodesBetween(from, to, (node, pos) => {
              if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
                decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'selectedCell' }))
                return false
              }
            })

            if (decos.length === 0) return null
            return DecorationSet.create(state.doc, decos)
          },

          handleDOMEvents: {
            mousedown(view, event) {
              if (event.button !== 0) return false
              if (event.ctrlKey || event.metaKey || event.shiftKey) return false

              const anchorCell = findCellDOM(event.target, view.dom)
              if (!anchorCell) return false

              let table = anchorCell.parentNode
              while (table && table !== view.dom && table.nodeName !== 'TABLE') {
                table = table.parentNode
              }
              if (!table || table.nodeName !== 'TABLE') return false

              const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
              if (!coords) return false
              const anchorPos = coords.pos

              let escaped = false
              let crossedCells = false
              const root = view.root

              function onMove(e) {
                const tableRect = table.getBoundingClientRect()
                const outside =
                  e.clientX < tableRect.left ||
                  e.clientX > tableRect.right ||
                  e.clientY < tableRect.top ||
                  e.clientY > tableRect.bottom

                // --- Cross-cell drag within the table ---
                if (!outside && !escaped) {
                  const headCell = findCellDOM(
                    root.elementFromPoint(e.clientX, e.clientY),
                    view.dom,
                  )
                  // Still in the same cell — let normal text selection work.
                  if (!headCell || headCell === anchorCell) {
                    // If we previously entered cross-cell mode but dragged
                    // back into the anchor cell, stay in cross-cell mode so
                    // that releasing still yields a single-cell CellSelection
                    // rather than a partial text selection.
                    if (!crossedCells) return
                  }

                  crossedCells = true
                  e.stopImmediatePropagation()

                  const headCoords = view.posAtCoords({ left: e.clientX, top: e.clientY })
                  if (!headCoords) return

                  const $anchor = view.state.doc.resolve(anchorPos)
                  const $head = view.state.doc.resolve(headCoords.pos)
                  const anchorCellPos = cellPosFromResolved($anchor)
                  const headCellPos = cellPosFromResolved($head)
                  if (anchorCellPos == null || headCellPos == null) return

                  const sel = CellSelection.create(view.state.doc, anchorCellPos, headCellPos)
                  const tr = view.state.tr.setSelection(sel)
                  view.dispatch(tr)
                  return
                }

                // --- Drag escaping outside the table ---
                escaped = true
                e.stopImmediatePropagation()

                const headCoords = view.posAtCoords({ left: e.clientX, top: e.clientY })
                if (!headCoords) return

                // Resolve the head position - when the mouse is in the gap
                // between nodes (e.g. between heading and table), posAtCoords
                // returns a doc-level position without inline content.
                // TextSelection.create defaults to searching forward which
                // snaps back INTO the table. Instead, search in the direction
                // we're dragging (away from anchor) to find the heading.
                let headPos = headCoords.pos
                const $head = view.state.doc.resolve(headPos)
                if (!$head.parent.inlineContent) {
                  const dir = headPos < anchorPos ? -1 : 1
                  const found =
                    Selection.findFrom($head, dir, true) ||
                    Selection.findFrom($head, -dir, true)
                  if (found) headPos = found.$head.pos
                }

                // Clear table editing state and set TextSelection in one transaction
                const tr = view.state.tr.setMeta('selectingCells$', -1)
                const sel = TextSelection.create(view.state.doc, anchorPos, headPos)
                tr.setSelection(sel)
                view.dispatch(tr)
                // Keep keyboard editing active after a table drag selection escapes the table.
                view.focus()
              }

              function onUp(e) {
                // If we committed to a cross-cell selection, prevent
                // prosemirror-tables' mouseup handler from resetting it.
                if (crossedCells) e.stopImmediatePropagation()
                root.removeEventListener('mousemove', onMove, true)
                root.removeEventListener('mouseup', onUp, true)
              }

              root.addEventListener('mousemove', onMove, true)
              root.addEventListener('mouseup', onUp, true)

              return false
            },
          },
        },
      }),
    ]
  },
})

export default TableDragEscape
