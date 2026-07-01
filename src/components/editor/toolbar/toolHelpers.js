import { useCallback } from 'react'
import { TextSelection } from '@tiptap/pm/state'
import { mixColors } from '../../../utils/colorUtils'
import { getListItemInfo } from '../../../utils/listHelpers'
import { getMountedEditorView } from '../../../utils/editorView'
import { THEME_BASE_COLORS } from './toolConstants'

// Shared, non-component helpers for the toolbar tools. Keeping these out of the
// component files means each `tools/*.jsx` file exports only components, which
// lets Vite fast-refresh them cleanly.

export const cmd = (editor) => editor?.chain().focus() ?? null

export function isInAnyList(editor) {
  return Boolean(
    editor?.isActive('bulletList') ||
    editor?.isActive('orderedList') ||
    editor?.isActive('taskList'),
  )
}

// Mobile-only indent/outdent. On touch, the editor selection often lives in
// the DOM only (no focus); we sync it into ProseMirror before dispatching.
export function useIndentOutdent(editor) {
  const syncSelectionFromDom = useCallback(() => {
    const view = getMountedEditorView(editor)
    if (!view || view.hasFocus()) return
    const selection = window.getSelection?.()
    const anchorNode = selection?.anchorNode
    const focusNode = selection?.focusNode
    if (!selection || selection.rangeCount === 0 || !anchorNode || !focusNode) return
    const root = view.dom
    const anchorElement =
      anchorNode.nodeType === Node.ELEMENT_NODE ? anchorNode : anchorNode.parentElement
    const focusElement =
      focusNode.nodeType === Node.ELEMENT_NODE ? focusNode : focusNode.parentElement
    const selectionInEditor =
      (anchorElement && root.contains(anchorElement)) ||
      (focusElement && root.contains(focusElement))
    if (!selectionInEditor) return
    try {
      const anchorPos = view.posAtDOM(anchorNode, selection.anchorOffset)
      const headPos = view.posAtDOM(focusNode, selection.focusOffset)
      const nextSelection = TextSelection.create(editor.state.doc, anchorPos, headPos)
      if (nextSelection.eq(editor.state.selection)) return
      view.dispatch(editor.state.tr.setSelection(nextSelection))
    } catch {
      // Ignore DOM-to-state selection sync failures
    }
  }, [editor])

  const handleIndent = useCallback(() => {
    if (!editor) return
    syncSelectionFromDom()
    const info = getListItemInfo(editor)
    if (!info || info.index === 0) return
    editor.chain().focus().sinkListItem(info.itemTypeName).run()
  }, [editor, syncSelectionFromDom])

  const handleOutdent = useCallback(() => {
    if (!editor) return
    syncSelectionFromDom()
    const info = getListItemInfo(editor)
    if (!info || !info.isNested) return
    editor.chain().focus().liftListItem(info.itemTypeName).run()
  }, [editor, syncSelectionFromDom])

  return { handleIndent, handleOutdent }
}

export function buildThemeRows() {
  const lightSteps = [0.2, 0.4, 0.6, 0.8]
  return [
    THEME_BASE_COLORS.slice(),
    ...lightSteps.map((amount) =>
      THEME_BASE_COLORS.map((base) => {
        const lower = base.toLowerCase()
        if (lower === '#ffffff') return mixColors(lower, '#000000', amount)
        return mixColors(lower, '#ffffff', amount)
      }),
    ),
  ]
}
