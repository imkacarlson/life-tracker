import { useCallback, useEffect, useRef } from 'react'
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
import { Clipboard } from '../extensions/clipboard'
import { Spellcheck } from '../extensions/spellcheck'
import { isTouchOnlyDevice } from '../utils/device'
import { scrollSelectionIntoViewWithToolbar } from '../utils/scrollIntoViewWithToolbar'
import { useEditorFocusRecovery } from './useEditorFocusRecovery'

// Desktop gets our in-app spell checker (custom right-click suggestions); the
// native browser squiggles are turned off there since our context menu owns the
// right-click. Touch-only devices keep native keyboard autocorrect and load
// nothing extra. Computed once at module load — pointer capabilities don't
// change mid-session.
const isDesktopSpellcheck = !isTouchOnlyDevice()

export const useEditorSetup = ({
  trackerSession,
  sessionKey,
  scheduleSave,
  scheduleSettingsSave,
  pendingEditTapRef,
  touchNavigationGuard,
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

  // Stable handler the Clipboard extension calls when a paste/drop carries an
  // image. Reading the ref inside a callback (not during render) keeps the
  // extension config referentially stable across renders.
  const handleImageFile = useCallback(
    (file) => {
      uploadImageRef.current?.(file)
    },
    [uploadImageRef],
  )

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
        // onImageFile only fires inside ProseMirror paste/drop handlers (user
        // events), never during render, so the ref read is safe to defer.
        // eslint-disable-next-line react-hooks/refs
        Clipboard.configure({
          onImageFile: handleImageFile,
        }),
        // In-app spell check (desktop only). Underlines misspellings; the
        // right-click menu reads its storage for suggestions.
        ...(isDesktopSpellcheck ? [Spellcheck] : []),
      ],
      content: trackerSession.content ?? EMPTY_DOC,
      editorProps: {
        attributes: {
          class: 'editor-content',
          // Suppress the browser's native squiggles on desktop so they don't
          // double up with ours; leave them (autocorrect) on touch devices.
          ...(isDesktopSpellcheck ? { spellcheck: 'false' } : {}),
        },
        // Route *every* selection-driven scroll (typing, arrows, find's
        // setSelection().scrollIntoView(), etc.) through our single chrome-aware
        // scroll. Returning true suppresses ProseMirror's native scroll-into-view
        // so the two never compete (no double-scroll "clank").
        handleScrollToSelection: (view) => {
          scrollSelectionIntoViewWithToolbar({ view, padding: 20 })
          return true
        },
        // Clipboard fidelity + image-paste/drop routing live in the Clipboard
        // extension (single owner), not here.
      },
    },
    [sessionKey, onNavigateHash],
  )

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
