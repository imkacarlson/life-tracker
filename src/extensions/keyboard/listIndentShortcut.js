import { Extension } from '@tiptap/core'
import { indentListItemWithoutChildren } from '../../utils/indentListItem'

export const ListIndentShortcut = Extension.create({
  name: 'listIndentShortcut',
  priority: 1000,
  addKeyboardShortcuts() {
    const indent = () => {
      if (this.editor.isActive('taskList') || this.editor.isActive('taskItem')) {
        return indentListItemWithoutChildren(this.editor, 'taskItem')
      }
      if (
        this.editor.isActive('bulletList') ||
        this.editor.isActive('orderedList') ||
        this.editor.isActive('listItem')
      ) {
        return indentListItemWithoutChildren(this.editor, 'listItem')
      }
      return false
    }

    return {
      Tab: () => indent(),
    }
  },
})
