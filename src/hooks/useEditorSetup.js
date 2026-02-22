import { useEffect, useLayoutEffect, useRef, useCallback, useState } from 'react'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import ListItem from '@tiptap/extension-list-item'
import TaskItem from '@tiptap/extension-task-item'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import TextAlign from '@tiptap/extension-text-align'
import { TableRow } from '@tiptap/extension-table'
import Placeholder from '@tiptap/extension-placeholder'
import { EMPTY_DOC } from '../utils/constants'
import { normalizeContent, sanitizeContentForSave } from '../utils/contentHelpers'
import { isTouchOnlyDevice } from '../utils/device'
import { summarizeSlice } from '../utils/pasteHelpers'
import { scrollToBlock } from '../utils/navigationHelpers'
import {
  ParagraphWithId,
  HeadingWithId,
  BulletListWithId,
  OrderedListWithId,
  TaskListWithId,
} from '../extensions/nodeExtensions'
import {
  TableWithId,
  TableCellWithBackground,
  TableHeaderWithBackground,
} from '../extensions/tableExtensions'
import { EnsureNodeIds, SecureImage, InternalLink } from '../extensions/editorExtensions'
import {
  LinkShortcut,
  BoldShortcut,
  ArrowMoveToLineEnd,
  ListIndentShortcut,
  ListSelectShortcut,
  ListEnterOutdent,
  ListExitOnEmpty,
  ListBackspaceOutdent,
  MobileLongPressSelect,
} from '../extensions/keyboardShortcuts'
import FindInDoc from '../extensions/findInDoc'
import TableDragEscape from '../extensions/tableDragEscape'

export const useEditorSetup = ({
  session,
  activeTrackerId,
  activeTracker,
  settingsMode,
  settingsContentVersion,
  templateContentRef,
  hydrateContentWithSignedUrls,
  scheduleSave,
  scheduleSettingsSave,
  pendingNavRef,
  pendingEditTapRef,
  onNavigateHash,
  uploadImageRef,
  deepLinkFocusGuard,
  deepLinkFocusGuardRef,
}) => {
  const suppressSaveRef = useRef(false)
  const suppressFocusRef = useRef(false)
  const contentOwnerTrackerIdRef = useRef(null)
  const activeTrackerIdRef = useRef(activeTrackerId)
  // Save only after a specific load pass has fully established page ownership.
  const saveLoadSessionRef = useRef({ id: 0, trackerId: null, ready: false })
  // activeTracker objects change frequently (e.g. autosave updates), but we only want to
  // reload/lock the editor on real navigation (tracker id or settings changes).
  const activeTrackerRef = useRef(activeTracker)
  useLayoutEffect(() => {
    activeTrackerRef.current = activeTracker
  }, [activeTracker])
  useEffect(() => {
    activeTrackerIdRef.current = activeTrackerId
  }, [activeTrackerId])
  const [editorLocked, setEditorLocked] = useState(false)
  const pasteInfoRef = useRef({
    summary: null,
    preFrom: null,
    preTo: null,
    isPmSlice: false,
    ts: 0,
    applied: false,
  })
  const pendingPasteFixRef = useRef(false)
  const previousDeepLinkFocusGuardRef = useRef(deepLinkFocusGuard)

  const getListDepthAt = useCallback((state, pos) => {
    const $pos = state.doc.resolve(pos)
    let depth = 0
    for (let d = $pos.depth; d > 0; d -= 1) {
      const name = $pos.node(d).type?.name
      if (name === 'bulletList' || name === 'orderedList' || name === 'taskList') {
        depth += 1
      }
    }
    return depth
  }, [])

  const getListItemTypeAt = useCallback((state, pos) => {
    const $pos = state.doc.resolve(pos)
    for (let d = $pos.depth; d > 0; d -= 1) {
      const name = $pos.node(d).type?.name
      if (name === 'taskItem') return 'taskItem'
      if (name === 'listItem') return 'listItem'
    }
    return null
  }, [])

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          bulletList: false,
          orderedList: false,
          listItem: false,
          link: false,
          underline: false,
          paragraph: false,
          heading: false,
        }),
        ParagraphWithId,
        HeadingWithId,
        BulletListWithId,
        OrderedListWithId,
        ListItem,
        TaskListWithId.configure({ nested: true }),
        TaskItem.configure({ nested: true }),
        Underline,
        Highlight.configure({ multicolor: true }),
        TextStyle,
        Color,
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        InternalLink.configure({
          autolink: true,
          openOnClick: false,
          linkOnPaste: true,
          onNavigateHash,
          HTMLAttributes: {
            target: '_self',
            rel: 'noopener noreferrer',
          },
        }),
        LinkShortcut,
        BoldShortcut,
        ArrowMoveToLineEnd,
        ListIndentShortcut,
        ListSelectShortcut,
        MobileLongPressSelect,
        ListEnterOutdent,
        ListExitOnEmpty,
        ListBackspaceOutdent,
        EnsureNodeIds,
        SecureImage.configure({ inline: false, allowBase64: false }),
        TableDragEscape,
        TableWithId.configure({ resizable: true }),
        TableRow,
        TableHeaderWithBackground,
        TableCellWithBackground,
        FindInDoc,
        Placeholder.configure({
          placeholder: 'Start writing your tracker...',
        }),
      ],
      content: EMPTY_DOC,
      editorProps: {
        attributes: {
          class: 'editor-content',
        },
        transformPasted: (slice) => {
          pasteInfoRef.current = {
            ...pasteInfoRef.current,
            summary: summarizeSlice(slice),
          }
          return slice
        },
        handlePaste: (view, event) => {
          const html = event.clipboardData?.getData('text/html') ?? ''
          pasteInfoRef.current = {
            ...pasteInfoRef.current,
            preFrom: view.state.selection.from,
            preTo: view.state.selection.to,
            isPmSlice: html.includes('data-pm-slice'),
            ts: Date.now(),
            applied: false,
          }
          pendingPasteFixRef.current = pasteInfoRef.current.isPmSlice
          const files = event.clipboardData?.files
          if (files && files.length > 0) {
            const imageFile = Array.from(files).find((file) => file.type.startsWith('image/'))
            if (imageFile) {
              event.preventDefault()
              uploadImageRef.current?.(imageFile)
              return true
            }
          }

          return false
        },
        handleDrop: (_view, event, _slice, moved) => {
          if (moved) return false
          const files = event.dataTransfer?.files
          if (!files || files.length === 0) return false
          const imageFile = Array.from(files).find((file) => file.type.startsWith('image/'))
          if (!imageFile) return false
          event.preventDefault()
          uploadImageRef.current?.(imageFile)
          return true
        },
      },
    },
    [session?.user?.id, onNavigateHash],
  )

  // Lock the editor during page/settings transitions so users can't type into content
  // that is about to be replaced (which can otherwise feel like "lost edits").
  useLayoutEffect(() => {
    if (!editor) return
    let mounted = true
    const loadSessionId = saveLoadSessionRef.current.id + 1
    saveLoadSessionRef.current = {
      id: loadSessionId,
      trackerId: activeTrackerId ?? null,
      ready: false,
    }
    contentOwnerTrackerIdRef.current = null

    const markLoadReady = (trackerId) => {
      if (!mounted) return
      if (saveLoadSessionRef.current.id !== loadSessionId) return
      saveLoadSessionRef.current = {
        id: loadSessionId,
        trackerId: trackerId ?? null,
        ready: true,
      }
      contentOwnerTrackerIdRef.current = trackerId ?? null
    }

    const setContent = async () => {
      suppressSaveRef.current = true
      setEditorLocked(true)
      if (!editor.isDestroyed) editor.setEditable(false)
      if (settingsMode === 'daily-template') {
        const rawContent = normalizeContent(templateContentRef.current)
        const hydrated = await hydrateContentWithSignedUrls(rawContent)
        if (!mounted) return
        editor.commands.setContent(hydrated, {
          emitUpdate: false,
          parseOptions: {
            preserveWhitespace: 'full',
          },
        })
        markLoadReady(null)
        suppressSaveRef.current = false
        setEditorLocked(false)
        if (!editor.isDestroyed) editor.setEditable(true)
        return
      }
      if (settingsMode) {
        markLoadReady(null)
        suppressSaveRef.current = false
        setEditorLocked(false)
        return
      }

      const rawContent = normalizeContent(activeTrackerRef.current?.content)
      const currentContent = sanitizeContentForSave(editor.getJSON())
      if (JSON.stringify(currentContent) === JSON.stringify(rawContent)) {
        const suppressProgrammaticFocus = isTouchOnlyDevice() && deepLinkFocusGuard
        markLoadReady(activeTrackerId ?? null)
        suppressSaveRef.current = false
        suppressFocusRef.current = true
        setEditorLocked(false)
        if (!editor.isDestroyed) editor.setEditable(!suppressProgrammaticFocus)
        if (suppressProgrammaticFocus && !editor.isDestroyed) {
          editor.view.dom.blur()
        }
        clearFocusTimer = setTimeout(() => {
          suppressFocusRef.current = false
        }, suppressProgrammaticFocus ? 600 : 50)
        return
      }
      const hydrated = await hydrateContentWithSignedUrls(rawContent)
      if (!mounted) return
      editor.commands.setContent(hydrated, {
        emitUpdate: false,
        parseOptions: {
          preserveWhitespace: 'full',
        },
      })
      markLoadReady(activeTrackerId ?? null)
      suppressSaveRef.current = false
      suppressFocusRef.current = true
      setEditorLocked(false)
      const pending = pendingNavRef.current
      const hasPendingBlock = pending?.blockId && pending.pageId === activeTrackerId
      const suppressProgrammaticFocus =
        isTouchOnlyDevice() && deepLinkFocusGuard && hasPendingBlock
      // Move selection to the start of the document before re-enabling
      // editable.  setEditable(true) triggers ProseMirror's selectionToDOM()
      // which causes the browser to auto-scroll to the caret.  By placing
      // the caret at position 1 (start), that native scroll targets the top.
      if (!editor.isDestroyed && !suppressProgrammaticFocus) {
        editor.commands.setTextSelection(1)
      }
      if (!editor.isDestroyed) editor.setEditable(!suppressProgrammaticFocus)
      if (suppressProgrammaticFocus && !editor.isDestroyed) {
        editor.view.dom.blur()
      }
      if (hasPendingBlock) {
        const attemptScroll = (attempts = 0) => {
          if (!mounted) return
          const success = scrollToBlock(pending.blockId, attempts)
          if (success || attempts >= 10) {
            pendingNavRef.current = null
          }
        }
        requestAnimationFrame(() => attemptScroll())
      }
      clearFocusTimer = setTimeout(() => {
        suppressFocusRef.current = false
      }, hasPendingBlock ? 600 : 50)
    }
    let clearFocusTimer
    setContent()
    return () => {
      mounted = false
      // When switching pages/settings, there is a brief window where the editor doc may still
      // reflect the previous page while React state already points at the next page.
      // Keep saves suppressed until the next effect finishes setting content/owner.
      suppressSaveRef.current = true
      contentOwnerTrackerIdRef.current = null
      saveLoadSessionRef.current = {
        id: saveLoadSessionRef.current.id,
        trackerId: null,
        ready: false,
      }
      clearTimeout(clearFocusTimer)
      suppressFocusRef.current = false
      if (!editor.isDestroyed) editor.setEditable(false)
    }
  }, [
    editor,
    activeTrackerId,
    hydrateContentWithSignedUrls,
    settingsMode,
    settingsContentVersion,
    templateContentRef,
    pendingNavRef,
    deepLinkFocusGuard,
  ])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (editorLocked || settingsMode) return
    const wasGuarded = previousDeepLinkFocusGuardRef.current
    previousDeepLinkFocusGuardRef.current = deepLinkFocusGuard
    const suppressProgrammaticFocus = isTouchOnlyDevice() && deepLinkFocusGuard
    if (suppressProgrammaticFocus) {
      editor.setEditable(false)
      editor.view.dom.blur()
      requestAnimationFrame(() => {
        if (!editor.isDestroyed) {
          editor.view.dom.blur()
        }
      })
      return
    }
    const tapIntent = pendingEditTapRef?.current
    if (wasGuarded && tapIntent && isTouchOnlyDevice()) {
      const pos = editor.view.posAtCoords(tapIntent)
      if (pos?.pos != null) {
        editor.commands.setTextSelection(pos.pos)
      }
      pendingEditTapRef.current = null
      editor.setEditable(true)
      requestAnimationFrame(() => {
        if (!editor.isDestroyed) {
          editor.view.focus()
        }
      })
      return
    }
    editor.setEditable(true)
  }, [editor, editorLocked, settingsMode, deepLinkFocusGuard, pendingEditTapRef])

  // If the DOM selection is inside the editor but focus has fallen back to <body>,
  // typing/backspace does nothing. This can happen after programmatic selections,
  // table interactions, or (historically) during autosave UI updates.
  useEffect(() => {
    if (!editor) return

    const shouldGuardDeepLinkFocus = isTouchOnlyDevice()
    let raf = null
    const handleSelectionChange = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = null
        if (!editor || editor.isDestroyed) return
        if (editorLocked) return
        if (suppressFocusRef.current) return
        if (shouldGuardDeepLinkFocus && (deepLinkFocusGuard || deepLinkFocusGuardRef.current)) return

        const activeEl = document.activeElement
        const activeTag = activeEl?.tagName
        // Only restore focus when focus has fallen back to the page itself (BODY/HTML),
        // not when the user is interacting with other controls (e.g. clicking the sidebar),
        // otherwise the browser may scroll to the current caret position (often near the end).
        if (activeTag && activeTag !== 'BODY' && activeTag !== 'HTML') return
        if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return

        const sel = window.getSelection?.()
        if (!sel || sel.rangeCount === 0) return

        const anchorNode = sel.anchorNode
        const focusNode = sel.focusNode
        const anchorEl = anchorNode
          ? anchorNode.nodeType === 1
            ? anchorNode
            : anchorNode.parentElement
          : null
        const focusEl = focusNode
          ? focusNode.nodeType === 1
            ? focusNode
            : focusNode.parentElement
          : null

        const root = editor.view?.dom
        if (!root) return
        const selectionInEditor =
          (anchorEl && root.contains(anchorEl)) || (focusEl && root.contains(focusEl))
        if (!selectionInEditor) return
        if (editor.view.hasFocus()) return

        const scrollX = window.scrollX
        const scrollY = window.scrollY
        editor.view.focus()
        // Browser may auto-scroll to the caret after focus; restore in next frame.
        requestAnimationFrame(() => window.scrollTo(scrollX, scrollY))
      })
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [editor, editorLocked, deepLinkFocusGuard])

  useEffect(() => {
    if (!editor) return
    const handleUpdate = () => {
      if (settingsMode === 'daily-template') {
        scheduleSettingsSave(editor.getJSON())
        return
      }
      if (suppressSaveRef.current) return
      // Never fall back to activeTrackerId here.
      // If we don't know who owns the current editor doc, we must not write it to any page.
      const targetTrackerId = contentOwnerTrackerIdRef.current
      if (!targetTrackerId) return
      const saveSession = saveLoadSessionRef.current
      // Guard against page-switch races: loaded owner, session owner, and active page must match.
      if (!saveSession.ready || saveSession.trackerId !== targetTrackerId) return
      if (activeTrackerIdRef.current !== targetTrackerId) return
      scheduleSave(editor.getJSON(), undefined, targetTrackerId)
    }
    editor.on('update', handleUpdate)
    return () => editor.off('update', handleUpdate)
  }, [editor, activeTrackerId, scheduleSave, scheduleSettingsSave, settingsMode])

  useEffect(() => {
    if (!editor) return
    const handleTransaction = ({ transaction }) => {
      const isPasteMeta =
        transaction.getMeta('paste') === true || transaction.getMeta('uiEvent') === 'paste'
      const isPending = pendingPasteFixRef.current
      if (!isPasteMeta && !isPending) return
      const info = pasteInfoRef.current
      if (!info?.isPmSlice || !info.summary?.length) {
        pendingPasteFixRef.current = false
        return
      }
      if (info.applied) return
      const { view } = editor
      const steps = transaction.mapping?.maps ?? []
      const firstStep = steps[0]
      const insertStart = firstStep ? firstStep.ranges[0] : null
      const insertOldSize = firstStep ? firstStep.ranges[1] : null
      const insertNewSize = firstStep ? firstStep.ranges[2] : null
      if (insertStart === null || insertOldSize === null || insertNewSize === null) {
        pendingPasteFixRef.current = false
        return
      }
      const mappedStart = insertStart
      const mappedEnd = insertStart + Math.max(insertNewSize, 0)
      const expectedCount = info.summary.length
      const applyFixes = () => {
        if (!view || view.isDestroyed) return
        const { state, dispatch } = view
        const summary = info.summary ?? []
        const targets = []
        state.doc.nodesBetween(mappedStart, Math.min(mappedEnd, state.doc.content.size), (node, pos) => {
          if (node.type?.name !== 'paragraph' && node.type?.name !== 'heading') return
          targets.push({ node, pos })
        })
        const limit = Math.min(expectedCount, summary.length, targets.length)
        const tr = state.tr
        for (let i = 0; i < limit; i += 1) {
          const expectedAlign = summary[i]?.align ?? 'left'
          const target = targets[i]
          if (!target) continue
          const nextAttrs = { ...target.node.attrs }
          if (!expectedAlign || expectedAlign === 'left') {
            if (nextAttrs.textAlign != null) delete nextAttrs.textAlign
          } else {
            nextAttrs.textAlign = expectedAlign
          }
          tr.setNodeMarkup(target.pos, undefined, nextAttrs)
        }
        if (tr.docChanged) dispatch(tr)

        let currentState = view.state
        for (let i = 0; i < limit; i += 1) {
          const expectedDepth = summary[i]?.listDepth ?? 0
          let currentTargets = []
          currentState.doc.nodesBetween(mappedStart, Math.min(mappedEnd, currentState.doc.content.size), (node, pos) => {
            if (node.type?.name !== 'paragraph' && node.type?.name !== 'heading') return
            currentTargets.push({ node, pos })
          })
          let currentTarget = currentTargets[i]
          if (!currentTarget) continue
          let actualDepth = getListDepthAt(currentState, currentTarget.pos + 1)
          let guard = 0
          while (actualDepth > expectedDepth && guard < 10) {
            const itemType = getListItemTypeAt(currentState, currentTarget.pos + 1)
            if (!itemType) break
            editor.chain().setTextSelection(currentTarget.pos + 1).liftListItem(itemType).run()
            currentState = editor.view.state
            currentTargets = []
            currentState.doc.nodesBetween(mappedStart, Math.min(mappedEnd, currentState.doc.content.size), (node, pos) => {
              if (node.type?.name !== 'paragraph' && node.type?.name !== 'heading') return
              currentTargets.push({ node, pos })
            })
            currentTarget = currentTargets[i]
            if (!currentTarget) break
            actualDepth = getListDepthAt(currentState, currentTarget.pos + 1)
            guard += 1
          }
        }
        pasteInfoRef.current = {
          summary: null,
          preFrom: null,
          preTo: null,
          isPmSlice: false,
          ts: 0,
          applied: false,
        }
        pendingPasteFixRef.current = false
      }
      pasteInfoRef.current = { ...pasteInfoRef.current, applied: true }
      setTimeout(applyFixes, 0)
    }
    editor.on('transaction', handleTransaction)
    return () => editor.off('transaction', handleTransaction)
  }, [editor, getListDepthAt, getListItemTypeAt])

  return { editor, editorLocked }
}
