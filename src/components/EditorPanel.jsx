import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { isTouchOnlyDevice } from '../utils/device'
import { getMountedEditorView } from '../utils/editorView'
import { useContentZoom } from '../hooks/useContentZoom'
import { useMobileToolbarTransform } from '../hooks/useMobileToolbarTransform'
import { useKeepCaretAboveKeyboard } from '../hooks/useKeepCaretAboveKeyboard'
import { useScrollRestoration } from '../hooks/useScrollRestoration'
import { useEditorUIStore } from '../stores/editorUIStore'
import EditorHeader from './editor/EditorHeader'
import Toolbar from './editor/Toolbar'
import AiInsertModal from './editor/AiInsertModal'
import EditorShell from './editor/EditorShell'
import EditorSkeleton from './editor/EditorSkeleton'
import { useAiDaily } from './editor/ai/useAiDaily'
import { useAiInsert } from './editor/ai/useAiInsert'
import EditorContextMenu from './editor/context-menu/EditorContextMenu'
import { useEditorContextMenu } from './editor/context-menu/useEditorContextMenu'
import { buildTableCommands } from './editor/table/tableCommands'

function EditorPanel({
  editor,
  editorLocked = false,
  title,
  onTitleChange,
  onDelete,
  saveStatus,
  onImageUpload,
  hasTracker,
  editorTransitioning = false,
  message,
  notebookId,
  sectionId,
  trackerId,
  restorePageId = null,
  onNavigateHash,
  allTrackers,
  trackerSourcePage = null,
  loadTrackerContent = null,
  onSetTrackerPage = null,
  trackerPageSaving = false,
  userId,
  titleReadOnly = false,
  showDelete = true,
  headerActions = null,
  showAiDaily = true,
  showAiInsert = true,
  deepLinkActive = false,
  emptyState = null,
  onAddCustomWord = null,
}) {
  const editorPanelRef = useRef(null)
  const editorShellRef = useRef(null)
  const toolbarRef = useRef(null)
  const zoomBadgeRef = useRef(null)
  const zoomHintRef = useRef(null)

  const highlightColor = useEditorUIStore((state) => state.highlightColor)
  const resetOnTrackerChange = useEditorUIStore((state) => state.resetOnTrackerChange)

  const isTouchOnly = useMemo(() => isTouchOnlyDevice(), [])
  const { zoomLevel, resetZoom, showHint, dismissHint, gestureRecent, isZoomSupported } =
    useContentZoom(editorShellRef, isTouchOnly)
  useMobileToolbarTransform({ enabled: isTouchOnly, toolbarRef })
  useKeepCaretAboveKeyboard({
    enabled: isTouchOnly,
    editor,
    toolbarRef,
    editorPanelRef,
    padding: 20,
  })
  useScrollRestoration({
    containerRef: editorPanelRef,
    editor,
    // Use the committed session id. The live tracker id changes before content swaps.
    pageId: restorePageId ?? trackerId,
    ready: hasTracker && !editorLocked,
    skip: deepLinkActive,
    zoomLevel,
    isTouchOnly,
  })

  // Touch commands avoid focusing a blurred editor, which would open the keyboard.
  const editorCmd = useCallback(() => {
    if (!editor) return null
    const view = getMountedEditorView(editor)
    return isTouchOnly && !view?.hasFocus() ? editor.chain() : editor.chain().focus()
  }, [editor, isTouchOnly])

  const { aiInsertModalProps } = useAiInsert({
    editor,
    hasTracker,
    title,
    trackerId,
    editorPanelRef,
    toolbarRef,
  })

  const { handleGenerateToday } = useAiDaily({
    editor,
    notebookId,
    sectionId,
    trackerId,
    allTrackers,
    trackerSourcePage,
    loadTrackerContent,
    userId,
  })

  const contextMenuItems = useMemo(
    () => buildTableCommands({ editor, editorCmd }),
    [editor, editorCmd],
  )
  const {
    toolbarDeepLinkHash,
    isCurrentPageTracker,
    handleSetTrackerFromToolbar,
    contextMenuProps,
  } = useEditorContextMenu({
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
  })

  useEffect(() => {
    if (!editor) return
    // eslint-disable-next-line react-hooks/immutability -- Tiptap extension storage is intentionally mutable runtime state.
    editor.storage.highlightColor = highlightColor ?? null
  }, [editor, highlightColor])

  useEffect(() => {
    if (!import.meta.env.DEV) return undefined
    window.__lifeTrackerEditor = editor ?? null
    return () => {
      if (window.__lifeTrackerEditor === editor) {
        window.__lifeTrackerEditor = null
      }
    }
  }, [editor])

  // Reset page-local UI and pre-focus without Tiptap restoring an old selection.
  useLayoutEffect(() => {
    resetOnTrackerChange()
    if (!editor || editorLocked) return
    const view = getMountedEditorView(editor)
    if (!view) return
    if (isTouchOnly && !view.hasFocus()) return
    view.dom.focus({ preventScroll: true })
  }, [trackerId, editor, editorLocked, resetOnTrackerChange, isTouchOnly])

  useEffect(() => {
    if (!editor) return
    if (typeof onNavigateHash === 'function') {
      // Navigation is handled by the Link extension plugin.
    }
  }, [editor, onNavigateHash])

  const hasHeaderActions = Boolean(headerActions) || showDelete
  const controlsDisabled = !hasTracker || editorLocked

  return (
    <section className="editor-panel" ref={editorPanelRef}>
      <EditorHeader
        title={title}
        onTitleChange={onTitleChange}
        onDelete={onDelete}
        saveStatus={saveStatus}
        hasTracker={hasTracker}
        editorTransitioning={editorTransitioning}
        message={message}
        titleReadOnly={titleReadOnly}
        editorLocked={editorLocked}
        controlsDisabled={controlsDisabled}
        hasHeaderActions={hasHeaderActions}
        headerActions={headerActions}
        showDelete={showDelete}
      />

      <Toolbar
        editor={editor}
        controlsDisabled={controlsDisabled}
        hasTracker={hasTracker}
        isTouchOnly={isTouchOnly}
        toolbarRef={toolbarRef}
        editorPanelRef={editorPanelRef}
        onImageUpload={onImageUpload}
        onAiDailyGenerate={handleGenerateToday}
        showAiDaily={showAiDaily}
        showAiInsert={showAiInsert}
        title={title}
        toolbarDeepLinkHash={toolbarDeepLinkHash}
        isCurrentPageTracker={isCurrentPageTracker}
        trackerPageSaving={trackerPageSaving}
        onSetTrackerPage={onSetTrackerPage}
        handleSetTrackerFromToolbar={handleSetTrackerFromToolbar}
        contextMenuItems={contextMenuItems}
      />

      <AiInsertModal
        {...aiInsertModalProps}
      />

      {editorLocked && hasTracker ? (
        <EditorSkeleton />
      ) : (
        <EditorShell
          ref={editorShellRef}
          hasTracker={hasTracker}
          editor={editor}
          emptyState={emptyState}
        />
      )}

      {isZoomSupported && zoomLevel !== 1.0 && (
        <button
          ref={zoomBadgeRef}
          type="button"
          className={`zoom-badge${gestureRecent ? ' zoom-badge--active' : ''}`}
          onMouseDown={(event) => event.preventDefault()}
          onTouchStart={(event) => event.preventDefault()}
          onClick={resetZoom}
          aria-label={`Zoom ${Math.round(zoomLevel * 100)}%. Tap to reset.`}
        >
          {Math.round(zoomLevel * 100)}%
        </button>
      )}

      {showHint && (
        <div ref={zoomHintRef} className="zoom-hint" onClick={dismissHint}>
          Pinch to zoom. Tap badge to reset.
        </div>
      )}

      <EditorContextMenu
        {...contextMenuProps}
        contextMenuItems={contextMenuItems}
      />
    </section>
  )
}

export default EditorPanel
