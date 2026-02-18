import { Extension } from '@tiptap/core'

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
