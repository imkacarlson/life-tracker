import { useCallback, useEffect } from 'react'
import { findInDocPluginKey } from '../../../extensions/findInDoc'
import { useEditorUIStore } from '../../../stores/editorUIStore'

/**
 * Owns the FindBar's wiring:
 *  1. Registers open/close callbacks on editor.storage.findInDoc so the custom
 *     extension can trigger the bar (e.g. from a keyboard shortcut).
 *  2. Syncs find plugin state → store on every transaction.
 *  3. Exposes the handlers the FindBar UI needs.
 *
 * Scrolling the current match into view is handled centrally by the editor's
 * handleScrollToSelection override (see useEditorSetup.js): the find commands
 * call setSelection().scrollIntoView(), which routes through that single
 * chrome-aware scroll. This hook no longer scrolls itself.
 *
 * The two ProseMirror reaches (editor.storage.findInDoc and
 * findInDocPluginKey.getState) are load-bearing; preserve their semantics.
 */
export function useFindBar({ editor, hasTracker, controlsDisabled, findInputRef }) {
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

  const handleFindQueryChange = useCallback((value) => {
    setFindQuery(value)
    editor?.commands?.setFindQuery?.(value)
  }, [editor, setFindQuery])

  const handleFindNext = useCallback(() => {
    editor?.commands?.findNext?.()
  }, [editor])

  const handleFindPrev = useCallback(() => {
    editor?.commands?.findPrev?.()
  }, [editor])

  // The findInDoc extension stores open/close callbacks on its storage so the
  // keyboard-shortcut binding can trigger them; preserved verbatim.
  useEffect(() => {
    if (!editor) return undefined
    const findStorage = editor.storage.findInDoc
    if (!findStorage) return undefined
    // eslint-disable-next-line react-hooks/immutability -- Tiptap's prescribed mutable editor.storage bridge (see comment above)
    findStorage.open = openFind
    findStorage.close = closeFind
    return () => {
      if (editor.storage?.findInDoc) {
        editor.storage.findInDoc.open = null
        editor.storage.findInDoc.close = null
      }
    }
  }, [editor, openFind, closeFind])

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
