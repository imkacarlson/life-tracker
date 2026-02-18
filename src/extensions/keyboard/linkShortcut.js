import { Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

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
