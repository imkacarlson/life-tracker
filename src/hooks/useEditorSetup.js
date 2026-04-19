import { useEffect, useRef, useCallback } from 'react'
import { useEditor } from '@tiptap/react'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import { liftListItem as pmLiftListItem } from '@tiptap/pm/schema-list'
import { Extension } from '@tiptap/core'
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

import { isTouchOnlyDevice } from '../utils/device'
import { summarizeSlice } from '../utils/pasteHelpers'

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
import { getListDepthAt, getListItemTypeAt } from '../utils/listHelpers'

export const useEditorSetup = ({
  authSession,
  trackerSession,
  sessionKey,
  scheduleSave,
  scheduleSettingsSave,
  pendingNavRef,
  pendingEditTapRef,
  touchNavigationGuardRef,
  touchNavigationGuard,
  setTouchNavigationGuard,
  onNavigateHash,
  uploadImageRef,
  deepLinkFocusGuard,
  deepLinkFocusGuardRef,
}) => {
  // Tracks an active "highlight preserve session" started when the user deletes all
  // highlighted content (cursor moves past the span boundary). handleTextInput uses
  // this to apply the highlight to the very next typed character when the cursor is
  // no longer adjacent to any highlighted text. Cleared on navigation keys.
  const preservedHighlightRef = useRef(null)
  const suppressFocusRef = useRef(false)
  // True while the session is not yet ready (content still loading or idle).
  const isLoading = trackerSession.status !== 'ready'
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
  const previousTouchNavigationGuardRef = useRef(touchNavigationGuard)
  const pendingDesktopDeepLinkRecoveryRef = useRef(false)

  // getListDepthAt and getListItemTypeAt are imported from utils/listHelpers.js

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
        Highlight.configure({ multicolor: true }).extend({ inclusive: false }),
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
        // When highlighted content is deleted (backspace/delete), remember the
        // highlight mark so that the very next typed character still inherits it.
        // This makes editing a highlighted date token feel natural: delete "2/22",
        // type "3/7", and "3/7" stays highlighted.
        // Works alongside inclusive:false (which prevents paste bleed) because
        // appendTransaction only fires for user-input transactions, not paste.
        Extension.create({
          name: 'highlightPreserve',
          addProseMirrorPlugins() {
            return [
              new Plugin({
                appendTransaction(transactions, oldState, newState) {
                  const tr = transactions[0]
                  if (!tr || !tr.docChanged) return null
                  if (tr.getMeta('paste') || tr.getMeta('uiEvent') === 'paste') return null
                  if (tr.getMeta('history$')) return null
                  if (!newState.selection.empty) return null
                  const highlightType = oldState.schema.marks.highlight
                  if (!highlightType) return null

                  for (const step of tr.steps) {
                    // Skip AddMarkStep / RemoveMarkStep — they have a .mark property.
                    // This prevents our own applyFixes dispatch from triggering this.
                    if (step.mark !== undefined) continue
                    const from = step.from
                    const to = step.to ?? step.from
                    if (typeof from !== 'number') continue

                    if (from < to) {
                      // DELETION (possibly with replacement content in the same step)
                      // Gate: deletion must start within a highlight span.
                      let foundMark = null
                      oldState.doc.nodesBetween(
                        from,
                        Math.min(from + 1, to, oldState.doc.content.size),
                        (node) => {
                          if (!node.isText || foundMark) return
                          const h = node.marks.find((m) => m.type === highlightType)
                          if (h) foundMark = h
                        },
                      )
                      if (!foundMark) continue

                      preservedHighlightRef.current = foundMark

                      // If the step also inserted replacement content, highlight it directly.
                      const insertedSize = step.slice?.content?.size ?? 0
                      if (insertedSize > 0) {
                        const mark = highlightType.create({ color: foundMark.attrs?.color })
                        return newState.tr.addMark(from, from + insertedSize, mark)
                      }
                      // Pure deletion: preserve session is now active; next insertion handled below.
                      return null
                    }

                    // Pure insertions are handled by handleTextInput below.
                  }
                  return null
                },
              }),
            ]
          },
        }),
      ],
      content: trackerSession.content ?? EMPTY_DOC,
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
        // With inclusive:false on Highlight, $from.marks() at the mark's start boundary
        // excludes the mark, so ProseMirror won't carry it onto text typed to replace a
        // selection. Fix: when a printable key is pressed with a non-empty selection that
        // sits inside a highlight span, pre-load storedMarks (sampled from inside the
        // selection, not at its boundary) so ProseMirror's default text-input handler
        // uses them for the replacement.
        handleKeyDown: (view, event) => {
          // Navigation keys end the preserve session so that typing after cursor movement
          // does not accidentally inherit a previous highlight color.
          // Backspace/Delete are excluded: appendTransaction handles them.
          if (event.key.length !== 1) {
            if (!['Shift', 'CapsLock', 'Backspace', 'Delete'].includes(event.key)) {
              preservedHighlightRef.current = null
            }
            return false
          }
          if (event.ctrlKey || event.metaKey || event.altKey) {
            preservedHighlightRef.current = null
            return false
          }
          return false
        },
        // Intercept text input so the mark is applied in the same transaction as the
        // character insertion — avoiding a two-step dispatch where something can strip
        // the mark between the insert and the addMark steps.
        handleTextInput: (view, from, to, text) => {
          const { state } = view
          const highlightType = state.schema.marks.highlight
          if (!highlightType) return false

          // Chrome/contenteditable sometimes recomposes the entire text node after
          // backspaces, sending e.g. "Expenses due 3" instead of just "3".
          // Diff old vs new text to find which characters are actually new.
          const oldText = from < to ? state.doc.textBetween(from, to, '', '\ufffc') : ''
          let newStart = 0
          while (newStart < oldText.length && newStart < text.length && oldText[newStart] === text[newStart]) {
            newStart++
          }
          const newChars = text.slice(newStart)
          if (newChars.length === 0) return false

          // The position where new characters begin (in pre-insertion coordinates).
          const insertPos = from + newStart

          // Case A: the character immediately before the insert position is highlighted.
          let highlightToApply = null
          if (insertPos > 1) {
            state.doc.nodesBetween(insertPos - 1, Math.min(insertPos, state.doc.content.size), (node) => {
              if (!node.isText || highlightToApply) return
              const h = node.marks.find((m) => m.type === highlightType)
              if (h) highlightToApply = h
            })
          }

          // Case B: active preserve session — cursor backspaced out of the span entirely.
          if (!highlightToApply) highlightToApply = preservedHighlightRef.current ?? null

          if (!highlightToApply) return false

          // Dispatch the full replacement, but only mark the NEW characters.
          const mark = highlightType.create({ color: highlightToApply.attrs?.color })
          const markFrom = from + newStart
          const markTo = from + text.length
          const tr = state.tr
            .insertText(text, from, to)
            .addMark(markFrom, markTo, mark)
          view.dispatch(tr)
          return true
        },
      },
    },
    [sessionKey, onNavigateHash],
  )

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (isLoading || trackerSession.mode === 'settings') return
    const isTouchDevice = isTouchOnlyDevice()
    const wasGuarded =
      previousDeepLinkFocusGuardRef.current || previousTouchNavigationGuardRef.current
    previousDeepLinkFocusGuardRef.current = deepLinkFocusGuard
    previousTouchNavigationGuardRef.current = touchNavigationGuard
    const suppressProgrammaticFocus =
      isTouchDevice && (deepLinkFocusGuard || touchNavigationGuard)
    if (suppressProgrammaticFocus) {
      pendingDesktopDeepLinkRecoveryRef.current = false
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
    let handledInEditorTap = false
    if (wasGuarded && tapIntent?.inEditor) {
      const pos = editor.view.posAtCoords({
        left: tapIntent.left,
        top: tapIntent.top,
      })
      if (pos?.pos != null) editor.commands.setTextSelection(pos.pos)
      handledInEditorTap = true
    }
    if (wasGuarded) {
      pendingDesktopDeepLinkRecoveryRef.current = !isTouchDevice && !handledInEditorTap
      pendingEditTapRef.current = null
    }
    if (handledInEditorTap) {
      editor.setEditable(true)
      requestAnimationFrame(() => {
        if (!editor.isDestroyed) {
          editor.view.focus()
        }
      })
      return
    }
    editor.setEditable(true)
  }, [editor, isLoading, trackerSession.mode, deepLinkFocusGuard, touchNavigationGuard, pendingEditTapRef])

  // Desktop fallback for issue #61: when a deep-link highlight is cleared by a click
  // outside the editor, recover focus/caret on the next in-editor click.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (isTouchOnlyDevice()) return
    const root = editor.view?.dom
    if (!root) return

    const handlePointerDown = (event) => {
      if (event.pointerType === 'touch') return
      if (!pendingDesktopDeepLinkRecoveryRef.current) return
      if (isLoading || trackerSession.mode === 'settings') return
      if (deepLinkFocusGuard || deepLinkFocusGuardRef.current) return
      if (editor.view.hasFocus()) {
        pendingDesktopDeepLinkRecoveryRef.current = false
        return
      }

      const activeTag = document.activeElement?.tagName
      if (activeTag && activeTag !== 'BODY' && activeTag !== 'HTML') {
        pendingDesktopDeepLinkRecoveryRef.current = false
        return
      }

      const pos = editor.view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
      })
      if (pos?.pos != null) editor.commands.setTextSelection(pos.pos)

      pendingDesktopDeepLinkRecoveryRef.current = false
      requestAnimationFrame(() => {
        if (!editor.isDestroyed) editor.view.focus()
      })
    }

    root.addEventListener('pointerdown', handlePointerDown, true)
    return () => root.removeEventListener('pointerdown', handlePointerDown, true)
  }, [editor, isLoading, trackerSession.mode, deepLinkFocusGuard, deepLinkFocusGuardRef])

  // If the DOM selection is inside the editor but focus has fallen back to <body>,
  // typing/backspace does nothing. This can happen after programmatic selections,
  // table interactions, or (historically) during autosave UI updates.
  useEffect(() => {
    if (!editor) return

    const isTouchDevice = isTouchOnlyDevice()
    let raf = null
    const handleSelectionChange = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = null
        if (!editor || editor.isDestroyed) return
        if (isLoading) return
        if (suppressFocusRef.current) return
        // On touch devices the browser's native tap-to-focus handles editor
        // focusing — programmatic recovery here would open the keyboard
        // whenever the user taps any non-focusable element (toolbar toggle,
        // backdrop, etc.) because focus briefly falls to <body> while the DOM
        // selection remains inside the editor.
        if (isTouchDevice) return

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
  }, [editor, isLoading, deepLinkFocusGuard])

  useEffect(() => {
    if (!editor) return
    const handleUpdate = () => {
      if (trackerSession.mode === 'template') {
        scheduleSettingsSave(editor.getJSON())
        return
      }
      // Only save when the session is fully ready (content pre-loaded and editor mounted).
      if (trackerSession.status !== 'ready') return
      const targetTrackerId = trackerSession.trackerId
      if (!targetTrackerId) return
      scheduleSave(editor.getJSON(), undefined, targetTrackerId)
    }
    editor.on('update', handleUpdate)
    return () => editor.off('update', handleUpdate)
  }, [editor, sessionKey, scheduleSave, scheduleSettingsSave, trackerSession])

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
        const tr = state.tr.setMeta('addToHistory', false)
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

        const liftListItemWithoutHistory = (targetPos, itemTypeName) => {
          const nodeType = view.state.schema.nodes[itemTypeName]
          if (!nodeType) return false

          const selectionState = view.state.apply(
            view.state.tr.setSelection(TextSelection.create(view.state.doc, targetPos)),
          )
          let lifted = false
          const command = pmLiftListItem(nodeType)
          const applied = command(selectionState, (liftTr) => {
            if (!liftTr.docChanged) return
            liftTr.setMeta('addToHistory', false)
            dispatch(liftTr)
            lifted = true
          })

          return Boolean(applied && lifted)
        }

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
            const didLift = liftListItemWithoutHistory(currentTarget.pos + 1, itemType)
            if (!didLift) break
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
        // Re-apply highlight marks exactly as they existed in the clipboard.
        // This strips any mark bleed that ProseMirror introduced during paste normalization.
        const highlightState = view.state
        const highlightType = highlightState.schema.marks.highlight
        if (highlightType) {
          const highlightTargets = []
          highlightState.doc.nodesBetween(
            mappedStart,
            Math.min(mappedEnd, highlightState.doc.content.size),
            (node, pos) => {
              if (node.type?.name !== 'paragraph' && node.type?.name !== 'heading') return
              highlightTargets.push({ node, pos })
            },
          )
          const highlightTr = highlightState.tr.setMeta('addToHistory', false)
          for (let i = 0; i < Math.min(summary.length, highlightTargets.length); i += 1) {
            const target = highlightTargets[i]
            if (!target) continue
            const expectedHighlights = summary[i]?.highlights ?? []
            // If the user edited the pasted text before applyFixes ran (fast typing),
            // the paragraph text no longer matches the clipboard — skip it so we don't
            // strip highlights that the preserve-session already applied.
            const expectedText = summary[i]?.text ?? ''
            const actualText = target.node.textContent?.replace(/\s+/g, ' ').trim() ?? ''
            if (actualText !== expectedText) continue
            const nodeStart = target.pos + 1 // +1 to step inside the node
            const nodeEnd = nodeStart + target.node.content.size
            // Remove all existing highlight marks in this paragraph/heading
            highlightTr.removeMark(nodeStart, nodeEnd, highlightType)
            // Re-apply only the spans captured from the clipboard
            for (const span of expectedHighlights) {
              const spanFrom = nodeStart + span.from
              const spanTo = nodeStart + span.to
              if (spanFrom >= nodeEnd || spanTo > nodeEnd) continue
              const mark = highlightType.create({ color: span.color })
              highlightTr.addMark(spanFrom, spanTo, mark)
            }
          }
          if (highlightTr.docChanged) view.dispatch(highlightTr)
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

  return { editor, suppressFocusRef }
}
