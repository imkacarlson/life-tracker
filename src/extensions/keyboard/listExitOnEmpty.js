import { Extension } from '@tiptap/core'

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
