import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useKeepCursorVisible } from '../../hooks/useKeepCursorVisible'
import { useEditorUIStore } from '../../stores/editorUIStore'
import FindBar from './FindBar'
import ToolButton from './ToolButton'
import { ToolbarContext } from './toolbar/ToolbarContext'
import ToolbarGroup from './toolbar/ToolbarGroup'
import { CORE_GROUPS, EXTRA_GROUPS } from './toolbar/tools'
import { useFindBar } from './toolbar/useFindBar'
import { useAiSearch } from './toolbar/useAiSearch'

function Toolbar({
  editor,
  controlsDisabled,
  hasTracker,
  isTouchOnly,
  toolbarRef,
  editorPanelRef,
  onImageUpload,
  onAiDailyGenerate,
  showAiDaily,
  showAiInsert,
  title,
  toolbarDeepLinkHash,
  isCurrentPageTracker,
  trackerPageSaving,
  onSetTrackerPage,
  handleSetTrackerFromToolbar,
  contextMenuItems,
}) {
  const toolbarExpanded = useEditorUIStore((s) => s.toolbarExpanded)
  const setToolbarExpanded = useEditorUIStore((s) => s.setToolbarExpanded)
  const findOpen = useEditorUIStore((s) => s.findOpen)
  const findQuery = useEditorUIStore((s) => s.findQuery)
  const findStatus = useEditorUIStore((s) => s.findStatus)
  const aiSearchMode = useEditorUIStore((s) => s.aiSearchMode)
  const aiSearchLoading = useEditorUIStore((s) => s.aiSearchLoading)
  const setAiSearchMode = useEditorUIStore((s) => s.setAiSearchMode)

  const findInputRef = useRef(null)

  const { openFind, closeFind, handleFindQueryChange, handleFindNext, handleFindPrev } =
    useFindBar({ editor, hasTracker, controlsDisabled, editorPanelRef, findInputRef })

  const { scheduleAiSearch, cancelAiSearch } = useAiSearch({ editor })

  // On query change: always give instant literal feedback (handleFindQueryChange
  // updates the store + literal highlights). In AI mode, additionally schedule
  // the debounced semantic search, which replaces the literal matches on settle.
  const onFindQueryChange = useCallback(
    (value) => {
      handleFindQueryChange(value)
      if (aiSearchMode) {
        scheduleAiSearch(value)
      } else {
        cancelAiSearch()
      }
    },
    [handleFindQueryChange, aiSearchMode, scheduleAiSearch, cancelAiSearch],
  )

  // Toggling AI mode is one tap. Off = cancel any pending/in-flight request and
  // immediately revert to literal find for the current query (zero AI calls).
  const handleToggleAiMode = useCallback(() => {
    const next = !aiSearchMode
    setAiSearchMode(next)
    if (next) {
      if (findQuery) scheduleAiSearch(findQuery)
    } else {
      cancelAiSearch()
      editor?.commands?.setFindQuery?.(findQuery)
    }
  }, [aiSearchMode, setAiSearchMode, findQuery, scheduleAiSearch, cancelAiSearch, editor])

  // Closing the bar must also stop any pending/in-flight AI request.
  const handleCloseFind = useCallback(() => {
    cancelAiSearch()
    closeFind()
  }, [cancelAiSearch, closeFind])

  // Mobile cursor visibility when the toolbar lifts.
  useKeepCursorVisible({ enabled: isTouchOnly, editor, toolbarExpanded, toolbarRef, editorPanelRef })

  // Publish toolbar height as CSS custom property for mobile padding offsets.
  useEffect(() => {
    if (!isTouchOnly || !toolbarRef?.current) return undefined
    const el = toolbarRef.current
    const publishHeight = () => {
      const height = Math.ceil(el.getBoundingClientRect().height)
      document.documentElement.style.setProperty('--toolbar-height', `${height}px`)
    }
    const ro = new ResizeObserver((entries) => {
      if (!entries[0]) return
      publishHeight()
    })
    publishHeight()
    ro.observe(el)
    return () => {
      ro.disconnect()
      document.documentElement.style.removeProperty('--toolbar-height')
    }
  }, [isTouchOnly, toolbarRef])

  const ctxValue = useMemo(
    () => ({
      isTouchOnly,
      hasTracker,
      controlsDisabled,
      editorPanelRef,
      title,
      onImageUpload,
      onAiDailyGenerate,
      showAiDaily,
      showAiInsert,
      toolbarDeepLinkHash,
      isCurrentPageTracker,
      trackerPageSaving,
      onSetTrackerPage,
      handleSetTrackerFromToolbar,
      contextMenuItems,
      openFind,
    }),
    [
      isTouchOnly, hasTracker, controlsDisabled, editorPanelRef, title,
      onImageUpload, onAiDailyGenerate, showAiDaily, showAiInsert,
      toolbarDeepLinkHash, isCurrentPageTracker, trackerPageSaving,
      onSetTrackerPage, handleSetTrackerFromToolbar, contextMenuItems,
      openFind,
    ],
  )

  return (
    <ToolbarContext.Provider value={ctxValue}>
      <div
        ref={toolbarRef}
        className={`toolbar${controlsDisabled ? ' disabled' : ''}${isTouchOnly && !toolbarExpanded ? ' toolbar-collapsed' : ''}`}
        data-expanded={!isTouchOnly || toolbarExpanded ? 'true' : 'false'}
      >
        <div className="toolbar-core">
          {CORE_GROUPS.map((group) => (
            <ToolbarGroup key={group.id} group={group} editor={editor} />
          ))}
          {isTouchOnly && (
            <ToolButton
              isTouchOnly={isTouchOnly}
              className="toolbar-expand-toggle"
              onActivate={() => setToolbarExpanded((prev) => !prev)}
              ariaLabel={toolbarExpanded ? 'Collapse toolbar' : 'Expand toolbar'}
              testId="toolbar-expand-toggle"
            >
              {toolbarExpanded ? '▴' : '▾'}
            </ToolButton>
          )}
        </div>

        <div className="toolbar-extra">
          {EXTRA_GROUPS.map((group) => (
            <ToolbarGroup key={group.id} group={group} editor={editor} />
          ))}
        </div>

        {findOpen && hasTracker && (
          <FindBar
            inputRef={findInputRef}
            findQuery={findQuery}
            findStatus={findStatus}
            aiSearchMode={aiSearchMode}
            aiSearchLoading={aiSearchLoading}
            onToggleAiMode={handleToggleAiMode}
            onFindQueryChange={onFindQueryChange}
            onFindPrev={handleFindPrev}
            onFindNext={handleFindNext}
            onClose={handleCloseFind}
          />
        )}
      </div>
    </ToolbarContext.Provider>
  )
}

export default Toolbar
