import { useEffect, useRef } from 'react'
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
import { HighlightPreserve } from '../extensions/highlightPreserve'
import { usePasteAlignFix } from './usePasteAlignFix'
import { useEditorFocusRecovery } from './useEditorFocusRecovery'

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
  const suppressFocusRef = useRef(false)
  const isLoading = trackerSession.status !== 'ready'

  // Keep a ref to the latest session so handleUpdate always reads the current
  // trackerId without a stale closure, while the effect only re-subscribes on
  // real session-identity changes (sessionKey change).
  const trackerSessionRef = useRef(trackerSession)
  useEffect(() => {
    trackerSessionRef.current = trackerSession
  }, [trackerSession])

  // Shared refs written by editorProps paste handlers, read by usePasteAlignFix.
  const pasteInfoRef = useRef({
    summary: null,
    preFrom: null,
    preTo: null,
    isPmSlice: false,
    ts: 0,
    applied: false,
  })
  const pendingPasteFixRef = useRef(false)

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
        HighlightPreserve,
      ],
      content: trackerSession.content ?? EMPTY_DOC,
      editorProps: {
        attributes: { class: 'editor-content' },
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
    [sessionKey, onNavigateHash],
  )

  usePasteAlignFix(editor, pasteInfoRef, pendingPasteFixRef)

  useEditorFocusRecovery({
    editor,
    isLoading,
    trackerSessionMode: trackerSession.mode,
    deepLinkFocusGuard,
    deepLinkFocusGuardRef,
    touchNavigationGuard,
    pendingEditTapRef,
    suppressFocusRef,
  })

  // Autosave: read latest session via ref so we don't re-subscribe on autosaves.
  useEffect(() => {
    if (!editor) return
    const handleUpdate = () => {
      const session = trackerSessionRef.current
      if (session.mode === 'template') {
        scheduleSettingsSave(editor.getJSON())
        return
      }
      if (session.status !== 'ready') return
      const targetTrackerId = session.trackerId
      if (!targetTrackerId) return
      scheduleSave(editor.getJSON(), undefined, targetTrackerId)
    }
    editor.on('update', handleUpdate)
    return () => editor.off('update', handleUpdate)
  }, [editor, sessionKey, scheduleSave, scheduleSettingsSave])

  return { editor, suppressFocusRef }
}
