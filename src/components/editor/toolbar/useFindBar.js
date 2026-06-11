import { useCallback, useEffect } from 'react'
import { findInDocPluginKey } from '../../../extensions/findInDoc'
import { useEditorUIStore } from '../../../stores/editorUIStore'
import { scrollRectIntoViewWithToolbar } from '../../../utils/scrollIntoViewWithToolbar'

/**
 * Owns the FindBar's wiring:
 *  1. Registers open/close callbacks on editor.storage.findInDoc so the custom
 *     extension can trigger the bar (e.g. from a keyboard shortcut).
 *  2. Syncs find plugin state → store on every transaction.
 *  3. Exposes the handlers the FindBar UI needs.
 *
 * The two ProseMirror reaches (editor.storage.findInDoc and
 * findInDocPluginKey.getState) are load-bearing; preserve their semantics.
 */
export function useFindBar({ editor, hasTracker, controlsDisabled, editorPanelRef, findInputRef }) {
  const setFindOpen = useEditorUIStore((s) => s.setFindOpen)
  const setFindQuery = useEditorUIStore((s) => s.setFindQuery)
  const setFindStatus = useEditorUIStore((s) => s.setFindStatus)

  const openFind = useCallback(() => {
    if (!editor || !hasTracker) return
    setFindOpen(true)
    requestAnimationFrame(() => {
      findInputRef.current?.focus()
      findInputRef.current?.select()
    })
  }, [editor, hasTracker, setFindOpen, findInputRef])

  const closeFind = useCallback(() => {
    setFindOpen(false)
    setFindQuery('')
    editor?.commands?.clearFind?.()
    if (!editor || controlsDisabled) return
    requestAnimationFrame(() => {
      editor.chain().focus().run()
    })
  }, [editor, controlsDisabled, setFindOpen, setFindQuery])

  const scrollMatchIntoView = useCallback(() => {
    if (!editor) return
    requestAnimationFrame(() => {
      const container = editorPanelRef?.current
      if (!container) return
      const { view } = editor
      const toolbarEl = container.querySelector('.toolbar')
      const activeMatch = view.dom.querySelector('.find-match.current, .ai-find-match.current')
      if (activeMatch) {
        scrollRectIntoViewWithToolbar({
          rect: activeMatch.getBoundingClientRect(),
          container,
          toolbarEl,
          padding: 20,
        })
        return
      }

      const { from } = view.state.selection
      const coords = view.coordsAtPos(from)
      scrollRectIntoViewWithToolbar({
        rect: coords,
        container,
        toolbarEl,
        padding: 20,
      })
    })
  }, [editor, editorPanelRef])

  const handleFindQueryChange = useCallback((value) => {
    setFindQuery(value)
    editor?.commands?.setFindQuery?.(value)
    scrollMatchIntoView()
  }, [editor, setFindQuery, scrollMatchIntoView])

  const handleFindNext = useCallback(() => {
    editor?.commands?.findNext?.()
    scrollMatchIntoView()
  }, [editor, scrollMatchIntoView])

  const handleFindPrev = useCallback(() => {
    editor?.commands?.findPrev?.()
    scrollMatchIntoView()
  }, [editor, scrollMatchIntoView])

  // The findInDoc extension stores open/close callbacks on its storage so the
  // keyboard-shortcut binding can trigger them; preserved verbatim.
  useEffect(() => {
    if (!editor) return undefined
    const findStorage = editor.storage.findInDoc
    if (!findStorage) return undefined
    findStorage.open = openFind
    findStorage.close = closeFind
    findStorage.scrollCurrentMatch = scrollMatchIntoView
    return () => {
      if (editor.storage?.findInDoc) {
        editor.storage.findInDoc.open = null
        editor.storage.findInDoc.close = null
        editor.storage.findInDoc.scrollCurrentMatch = null
      }
    }
  }, [editor, openFind, closeFind, scrollMatchIntoView])

  // Mirror plugin state (matches, index, query) into the store on every txn.
  useEffect(() => {
    if (!editor) return undefined
    const syncFindState = () => {
      const pluginState = findInDocPluginKey.getState(editor.state)
      if (!pluginState) return
      setFindStatus(pluginState)
      setFindQuery(pluginState.query || '')
    }
    syncFindState()
    editor.on('transaction', syncFindState)
    return () => editor.off('transaction', syncFindState)
  }, [editor, setFindStatus, setFindQuery])

  return { openFind, closeFind, handleFindQueryChange, handleFindNext, handleFindPrev }
}
