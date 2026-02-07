import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'

const tableDragEscapeKey = new PluginKey('tableDragEscape')

const TableDragEscape = Extension.create({
  name: 'tableDragEscape',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: tableDragEscapeKey,
        props: {
          handleDOMEvents: {
            mousedown(view, event) {
              if (event.button !== 0) return false
              if (event.ctrlKey || event.metaKey || event.shiftKey) return false

              let dom = event.target
              let cell = null
              while (dom && dom !== view.dom) {
                if (dom.nodeName === 'TD' || dom.nodeName === 'TH') {
                  cell = dom
                  break
                }
                dom = dom.parentNode
              }
              if (!cell) return false

              let table = cell.parentNode
              while (table && table !== view.dom && table.nodeName !== 'TABLE') {
                table = table.parentNode
              }
              if (!table || table.nodeName !== 'TABLE') return false

              const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
              if (!coords) return false
              const anchorPos = coords.pos

              let escaped = false
              const root = view.root

              function onMove(e) {
                const tableRect = table.getBoundingClientRect()
                const outside =
                  e.clientX < tableRect.left ||
                  e.clientX > tableRect.right ||
                  e.clientY < tableRect.top ||
                  e.clientY > tableRect.bottom

                if (!outside && !escaped) return

                escaped = true
                e.stopImmediatePropagation()

                // Clear prosemirror-tables internal editing state
                const tr = view.state.tr.setMeta('selectingCells$', -1)
                view.dispatch(tr)

                const headCoords = view.posAtCoords({ left: e.clientX, top: e.clientY })
                if (!headCoords) return

                const sel = TextSelection.create(view.state.doc, anchorPos, headCoords.pos)
                view.dispatch(view.state.tr.setSelection(sel))
              }

              function onUp() {
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
