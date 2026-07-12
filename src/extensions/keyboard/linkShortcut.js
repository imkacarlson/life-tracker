import { Extension } from '@tiptap/core'
import { toggleLineStrike } from './toggleLineStrike'
import { clearLineFormatting } from './clearLineFormatting'
import { applyMarkSmart, toggleMarkSmart, isMarkActiveForToggle } from '../../utils/smartMark'

export const LinkShortcut = Extension.create({
  name: 'linkShortcut',
  addKeyboardShortcuts() {
    return {
      // Bold/Italic/Underline mirror the toolbar buttons: a collapsed caret
      // formats the whole line and arms continued typing. LinkShortcut already
      // overrides Mod-b/Mod-i; Mod-u overrides the Underline extension default.
      'Mod-b': () => {
        toggleMarkSmart(this.editor, this.editor.schema.marks.bold, { level: 'block' })
        return true
      },
      'Mod-i': () => {
        toggleMarkSmart(this.editor, this.editor.schema.marks.italic, { level: 'block' })
        return true
      },
      'Mod-u': () => {
        toggleMarkSmart(this.editor, this.editor.schema.marks.underline, { level: 'block' })
        return true
      },
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
        toggleLineStrike(this.editor)
        return true
      },
      'Mod-\\': () => {
        clearLineFormatting(this.editor)
        return true
      },
      'Mod-.': () => {
        this.editor.chain().focus().toggleBulletList().run()
        return true
      },
      // Highlight mirrors the toolbar: word-level on a collapsed caret, driven
      // by the chosen color (editor.storage.highlightColor mirrors the store).
      // No hard-coded default — matching the toolbar, an unset color removes.
      'Mod-Alt-h': () => {
        const editor = this.editor
        const highlightMark = editor.schema.marks.highlight
        const color = editor.storage?.highlightColor
        const remove = isMarkActiveForToggle(editor.state, highlightMark) || !color
        applyMarkSmart(editor, highlightMark, {
          level: 'word',
          attrs: remove ? null : { color },
          remove,
        })
        return true
      },
    }
  },
})
