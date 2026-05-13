import { useEffect, useMemo, useRef } from 'react'
import { useKeepCursorVisible } from '../../hooks/useKeepCursorVisible'
import { useEditorUIStore } from '../../stores/editorUIStore'
import FindBar from './FindBar'
import ToolButton from './ToolButton'
import { ToolbarContext } from './toolbar/ToolbarContext'
import ToolbarGroup from './toolbar/ToolbarGroup'
import { CORE_GROUPS, EXTRA_GROUPS } from './toolbar/tools'
import { useFindBar } from './toolbar/useFindBar'

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

  const findInputRef = useRef(null)

  const { openFind, closeFind, handleFindQueryChange, handleFindNext, handleFindPrev } =
    useFindBar({ editor, hasTracker, controlsDisabled, editorPanelRef, findInputRef })

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
            onFindQueryChange={handleFindQueryChange}
            onFindPrev={handleFindPrev}
            onFindNext={handleFindNext}
            onClose={closeFind}
          />
        )}
      </div>
    </ToolbarContext.Provider>
  )
}

export default Toolbar
