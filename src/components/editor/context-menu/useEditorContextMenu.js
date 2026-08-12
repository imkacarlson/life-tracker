import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getChecker } from '../../../lib/spellChecker'
import { useEditorUIStore } from '../../../stores/editorUIStore'
import { isTouchOnlyDevice } from '../../../utils/device'
import { getMountedEditorView } from '../../../utils/editorView'
import { buildHash } from '../../../utils/navigationHelpers'

const getCellFromEvent = (event) => event.target?.closest?.('td, th') ?? null

const getActiveBlockId = (editor) => {
  if (!editor) return null
  const { $from } = editor.state.selection
  let fallbackId = null
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    const id = node?.attrs?.id
    if (!id) continue
    if (node.type?.name === 'paragraph' || node.type?.name === 'heading') return id
    fallbackId ||= id
  }
  return fallbackId
}

const isTouchContextMenuEvent = (event) =>
  isTouchOnlyDevice() ||
  event.pointerType === 'touch' ||
  Boolean(event.sourceCapabilities?.firesTouchEvents)

export function useEditorContextMenu({
  editor,
  editorLocked,
  isTouchOnly,
  hasTracker,
  notebookId,
  sectionId,
  trackerId,
  trackerSourcePage,
  trackerPageSaving,
  onSetTrackerPage,
  onAddCustomWord,
}) {
  const menuRef = useRef(null)
  const submenuRef = useRef(null)
  const [spellSuggestions, setSpellSuggestions] = useState([])
  const {
    contextMenu,
    setContextMenu,
    submenuOpen,
    setSubmenuOpen,
    submenuDirection,
    setSubmenuDirection,
    currentBlockId,
    setCurrentBlockId,
    setInTable,
    aiInsertLoading,
    setAiInsertOpen,
  } = useEditorUIStore()

  const openContextMenu = useCallback(
    (next) => {
      setContextMenu({
        open: true,
        x: next.x,
        y: next.y,
        blockId: next.blockId ?? null,
        inTable: next.inTable ?? false,
        misspelling: next.misspelling ?? null,
      })
      setSubmenuOpen(false)
    },
    [setContextMenu, setSubmenuOpen],
  )

  const closeContextMenu = useCallback(() => {
    setContextMenu((previous) => (previous.open ? { ...previous, open: false } : previous))
    setSubmenuOpen(false)
  }, [setContextMenu, setSubmenuOpen])

  const focusFromCoords = useCallback(
    (coords) => {
      const view = getMountedEditorView(editor)
      if (!view) return
      const pos = view.posAtCoords(coords)
      if (pos?.pos !== undefined) {
        editor.chain().focus().setTextSelection(pos.pos).run()
      }
    },
    [editor],
  )

  useEffect(() => {
    const view = getMountedEditorView(editor)
    if (!view?.dom) return
    const dom = view.dom

    const handleContextMenu = (event) => {
      if (editorLocked || event.shiftKey || isTouchContextMenuEvent(event)) return
      event.preventDefault()
      focusFromCoords({ left: event.clientX, top: event.clientY })
      const inTable = Boolean(getCellFromEvent(event))
      const blockId = getActiveBlockId(editor)
      let misspelling = null
      const getMisspellingAt = editor.storage?.spellcheck?.getMisspellingAt
      if (typeof getMisspellingAt === 'function') {
        const targetElement =
          event.target?.nodeType === Node.TEXT_NODE ? event.target.parentElement : event.target
        const errorElement = targetElement?.closest?.('.spellcheck-error')
        if (errorElement && editor.view) {
          try {
            const pos = editor.view.posAtDOM(errorElement.firstChild ?? errorElement, 0)
            misspelling = getMisspellingAt(pos)
          } catch {
            misspelling = null
          }
        }
        if (!misspelling) {
          const coords = editor.view?.posAtCoords({ left: event.clientX, top: event.clientY })
          if (coords?.pos !== undefined) {
            misspelling = getMisspellingAt(coords.pos)
          }
        }
      }
      openContextMenu({ x: event.clientX, y: event.clientY, blockId, inTable, misspelling })
    }

    dom.addEventListener('contextmenu', handleContextMenu)
    return () => dom.removeEventListener('contextmenu', handleContextMenu)
  }, [editor, editorLocked, focusFromCoords, openContextMenu])

  useEffect(() => {
    if (!contextMenu.open) return
    const menu = menuRef.current
    if (!menu) return
    const padding = 8
    const rect = menu.getBoundingClientRect()
    let nextX = Math.min(contextMenu.x, window.innerWidth - rect.width - padding)
    let nextY = Math.min(contextMenu.y, window.innerHeight - rect.height - padding)
    nextX = Math.max(padding, nextX)
    nextY = Math.max(padding, nextY)
    if (nextX !== contextMenu.x || nextY !== contextMenu.y) {
      setContextMenu((previous) => ({ ...previous, x: nextX, y: nextY }))
    }
  }, [contextMenu.open, contextMenu.x, contextMenu.y, setContextMenu])

  useEffect(() => {
    if (!submenuOpen) return
    const menu = menuRef.current
    const submenu = submenuRef.current
    if (!menu || !submenu) return
    const padding = 12
    const menuRect = menu.getBoundingClientRect()
    const submenuRect = submenu.getBoundingClientRect()
    const openRight = menuRect.right + submenuRect.width + padding < window.innerWidth
    setSubmenuDirection(openRight ? 'right' : 'left')
  }, [submenuOpen, setSubmenuDirection])

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!contextMenu.open) return
      const menu = menuRef.current
      if (menu?.contains(event.target)) return
      closeContextMenu()
    }

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return
      if (!aiInsertLoading) {
        setAiInsertOpen(false)
      }
      closeContextMenu()
    }

    document.addEventListener('mousedown', handleOutsideClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu.open, aiInsertLoading, closeContextMenu, setAiInsertOpen])

  const deepLinkHash = useMemo(() => {
    if (!contextMenu.blockId || !trackerId || !notebookId || !sectionId) return null
    return buildHash({
      notebookId,
      sectionId,
      pageId: trackerId,
      blockId: contextMenu.blockId,
    })
  }, [contextMenu.blockId, trackerId, notebookId, sectionId])

  const toolbarDeepLinkHash = useMemo(() => {
    if (!currentBlockId || !trackerId || !notebookId || !sectionId) return null
    return buildHash({ notebookId, sectionId, pageId: trackerId, blockId: currentBlockId })
  }, [currentBlockId, trackerId, notebookId, sectionId])

  const isCurrentPageTracker = Boolean(trackerId && trackerSourcePage?.id === trackerId)

  const handleCopyLink = async () => {
    if (!deepLinkHash) return
    await navigator.clipboard.writeText(deepLinkHash)
    closeContextMenu()
  }

  useEffect(() => {
    const misspelling = contextMenu.misspelling
    if (!contextMenu.open || !misspelling || isTouchOnly) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- closing the menu synchronously clears stale suggestions.
      setSpellSuggestions([])
      return
    }
    let cancelled = false
    getChecker()
      .then((checker) => {
        if (cancelled) return
        const suggestions = checker.suggest(misspelling.word) ?? []
        setSpellSuggestions(suggestions.slice(0, 5))
      })
      .catch(() => {
        if (!cancelled) setSpellSuggestions([])
      })
    return () => {
      cancelled = true
    }
  }, [contextMenu.open, contextMenu.misspelling, isTouchOnly])

  const handleApplySuggestion = (suggestion) => {
    const misspelling = contextMenu.misspelling
    if (!editor || !misspelling) return
    editor
      .chain()
      .focus()
      .insertContentAt({ from: misspelling.from, to: misspelling.to }, suggestion)
      .run()
    closeContextMenu()
  }

  const handleAddToDictionary = async () => {
    const word = contextMenu.misspelling?.word
    if (!word) return
    editor?.storage?.spellcheck?.addCustomWord(word)
    closeContextMenu()
    if (onAddCustomWord) {
      try {
        await onAddCustomWord(word)
      } catch (err) {
        console.error('Failed to persist custom word:', err)
      }
    }
  }

  const handleIgnoreWord = () => {
    const word = contextMenu.misspelling?.word
    if (!word) return
    editor?.storage?.spellcheck?.ignoreWord(word)
    closeContextMenu()
  }

  const handleSetTrackerPageFromMenu = async () => {
    if (!trackerId || !onSetTrackerPage || isCurrentPageTracker || trackerPageSaving) return
    await onSetTrackerPage(trackerId)
    closeContextMenu()
  }

  const handleSetTrackerFromToolbar = async () => {
    if (!trackerId || !onSetTrackerPage || isCurrentPageTracker || trackerPageSaving) return
    await onSetTrackerPage(trackerId)
  }

  useEffect(() => {
    if (!editor) return
    const syncEditorState = () => {
      const nextInTable =
        editor.isActive('table') ||
        editor.isActive('tableCell') ||
        editor.isActive('tableHeader')
      setInTable(nextInTable)
      setCurrentBlockId(getActiveBlockId(editor))
    }
    syncEditorState()
    editor.on('selectionUpdate', syncEditorState)
    editor.on('transaction', syncEditorState)
    return () => {
      editor.off('selectionUpdate', syncEditorState)
      editor.off('transaction', syncEditorState)
    }
  }, [editor, setInTable, setCurrentBlockId])

  return {
    toolbarDeepLinkHash,
    isCurrentPageTracker,
    handleSetTrackerFromToolbar,
    contextMenuProps: {
      menuRef,
      submenuRef,
      contextMenu,
      spellSuggestions,
      deepLinkHash,
      hasTracker,
      isCurrentPageTracker,
      trackerPageSaving,
      onSetTrackerPage,
      submenuOpen,
      submenuDirection,
      setSubmenuOpen,
      closeContextMenu,
      handleApplySuggestion,
      handleAddToDictionary,
      handleIgnoreWord,
      handleCopyLink,
      handleSetTrackerPageFromMenu,
    },
  }
}
