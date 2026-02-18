import { Extension } from '@tiptap/core'

export const BoldShortcut = Extension.create({
  name: 'boldShortcut',
  addKeyboardShortcuts() {
    return {
      'Mod-b': () => this.editor.chain().focus().toggleBold().run(),
    }
  },
})
