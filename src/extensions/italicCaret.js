import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { shouldShowItalicCaret, caretStyleFromRect } from '../utils/italicCaret'

// No browser slants the native text caret for italic — it is always a vertical
// bar and no CSS/font property changes that. So when italic is active we hide
// the native caret (via `.italic-caret-active { caret-color: transparent }`)
// and draw our own skewed caret element instead. Everywhere else the native
// caret stays untouched, keeping the risk contained to the italic-only path.
//
// The feature runs on desktop AND touch — it is deliberately NOT gated on
// pointer type (that would disable it on mobile, where it was verified to work).

const ITALIC_CARET_ACTIVE_CLASS = 'italic-caret-active'
const ITALIC_CARET_CLASS = 'italic-caret'

export const ItalicCaret = Extension.create({
  name: 'italicCaret',

  addProseMirrorPlugins() {
    // Captured here (not inside the plugin view) so the view has the Tiptap
    // editor for `isActive('italic')`/`isFocused` — the DOM cannot answer the
    // armed-on-empty-spot case (storedMarks italic, but `<p><br></p>`), so
    // detection must come from editor state.
    const editor = this.editor

    return [
      new Plugin({
        key: new PluginKey('italicCaret'),
        view: (view) => new ItalicCaretView(view, editor),
      }),
    ]
  },
})

class ItalicCaretView {
  constructor(view, editor) {
    this.view = view
    this.editor = editor
    this.active = false

    // The caret is `position: fixed` (viewport coords), so it lives on
    // document.body rather than inside the editor's scroll container.
    this.caret = document.createElement('div')
    this.caret.className = ITALIC_CARET_CLASS
    this.caret.setAttribute('aria-hidden', 'true')
    this.caret.style.display = 'none'
    document.body.appendChild(this.caret)

    // Bound so add/removeEventListener reference the same function.
    this.handleReposition = () => this.render()
    this.handleFocus = () => this.render()

    // Recompute after a programmatic focus: `editor.isFocused` can read false
    // for one tick right after `.focus()`, which a transaction-only update would
    // miss. The focus event fires once the state settles.
    editor.on('focus', this.handleFocus)
    editor.on('blur', this.handleFocus)

    // Capture-phase so it catches BOTH the nested desktop scroller
    // (section.editor-panel) and the mobile window scroll with one listener.
    window.addEventListener('scroll', this.handleReposition, true)
    window.addEventListener('resize', this.handleReposition)

    // Virtual keyboard / mobile URL-bar move the visual viewport without a
    // document scroll; track those so the fixed caret stays glued to the text.
    this.visualViewport = window.visualViewport ?? null
    if (this.visualViewport) {
      this.visualViewport.addEventListener('resize', this.handleReposition)
      this.visualViewport.addEventListener('scroll', this.handleReposition)
    }

    this.render()
  }

  update() {
    // Fires on every transaction (selection changes, typing, italic toggle).
    this.render()
  }

  render() {
    const { editor, view } = this
    if (editor.isDestroyed) return this.hide()

    const state = view.state
    const show = shouldShowItalicCaret({
      focused: editor.isFocused,
      selectionEmpty: state.selection.empty,
      italicActive: editor.isActive('italic'),
    })

    if (!show) return this.hide()

    // coordsAtPos returns a solid non-zero rect for every block type incl.
    // empty paragraph / table cell / heading (collapsed DOM ranges do not).
    let coords
    try {
      coords = view.coordsAtPos(state.selection.from)
    } catch {
      return this.hide()
    }

    const style = caretStyleFromRect(coords)
    this.caret.style.left = `${style.left}px`
    this.caret.style.top = `${style.top}px`
    this.caret.style.height = `${style.height}px`
    this.caret.style.transform = style.transform
    this.show()
  }

  show() {
    if (!this.active) {
      this.active = true
      this.view.dom.classList.add(ITALIC_CARET_ACTIVE_CLASS)
    }
    this.caret.style.display = 'block'
  }

  hide() {
    if (this.active) {
      this.active = false
      this.view.dom.classList.remove(ITALIC_CARET_ACTIVE_CLASS)
    }
    this.caret.style.display = 'none'
  }

  destroy() {
    this.editor.off('focus', this.handleFocus)
    this.editor.off('blur', this.handleFocus)
    window.removeEventListener('scroll', this.handleReposition, true)
    window.removeEventListener('resize', this.handleReposition)
    if (this.visualViewport) {
      this.visualViewport.removeEventListener('resize', this.handleReposition)
      this.visualViewport.removeEventListener('scroll', this.handleReposition)
    }
    this.view.dom.classList.remove(ITALIC_CARET_ACTIVE_CLASS)
    this.caret.remove()
  }
}
