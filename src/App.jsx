import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from './hooks/useAuth'
import { useNotebooks } from './hooks/useNotebooks'
import { useSections } from './hooks/useSections'
import { useTrackers } from './hooks/useTrackers'
import { useSettings } from './hooks/useSettings'
import { useNavigation } from './hooks/useNavigation'
import { useContentHydration } from './hooks/useContentHydration'
import { useImageUpload } from './hooks/useImageUpload'
import { useEditorSetup } from './hooks/useEditorSetup'
import { clearNavHierarchyCache } from './utils/resolveNavHierarchy'
import { isTouchOnlyDevice } from './utils/device'
import {
  saveSelection,
  readStoredSidebarCollapsed,
  readStoredSelection,
  readStoredSidebarWidth,
  saveStoredSidebarCollapsed,
  saveStoredSidebarWidth,
} from './utils/storage'
import EditorPanel from './components/EditorPanel'
import SettingsHub from './components/SettingsHub'
import AuthForm from './components/AuthForm'
import WelcomeScreen from './components/WelcomeScreen'
import SlimHeader from './components/app/SlimHeader'
import NavigationTree from './components/app/NavigationTree'
import TreeContextMenu from './components/app/TreeContextMenu'
import CopyMoveModal from './components/app/CopyMoveModal'
import ConflictModal from './components/app/ConflictModal'
import './styles/index.css'

const DEFAULT_SIDEBAR_WIDTH = 280
const MIN_SIDEBAR_WIDTH = 220
const MIN_EDITOR_WIDTH = 520
const SIDEBAR_RESIZER_WIDTH = 14
const SIDEBAR_BADGE_COMPACT_WIDTH = 300
const POINTER_TAP_DISTANCE_PX = 10
const MOBILE_BREAKPOINT_PX = 900

const clampSidebarWidth = (width, workspaceWidth) => {
  const maxSidebarWidth = Math.max(
    MIN_SIDEBAR_WIDTH,
    workspaceWidth - SIDEBAR_RESIZER_WIDTH - MIN_EDITOR_WIDTH,
  )
  return Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), maxSidebarWidth)
}

const getWorkspaceContentWidth = (workspaceEl) => {
  const computed = window.getComputedStyle(workspaceEl)
  const paddingLeft = Number.parseFloat(computed.paddingLeft) || 0
  const paddingRight = Number.parseFloat(computed.paddingRight) || 0
  return Math.max(0, workspaceEl.clientWidth - paddingLeft - paddingRight)
}

function App() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  const missingEnv = !supabaseUrl || !supabaseAnonKey

  const savedSelectionRef = useRef(readStoredSelection())
  const pendingNavRef = useRef(null)
  const pendingEditTapRef = useRef(null)
  const deepLinkFocusGuardRef = useRef(false)
  const [deepLinkFocusGuard, setDeepLinkFocusGuard] = useState(false)
  const pointerGestureRef = useRef(null)
  const workspaceRef = useRef(null)
  const resizeStateRef = useRef(null)
  const sidebarWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH)
  const [isMobileViewport, setIsMobileViewport] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT_PX,
  )
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readStoredSidebarWidth(DEFAULT_SIDEBAR_WIDTH),
  )
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    readStoredSidebarCollapsed(false),
  )
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [isResizingSidebar, setIsResizingSidebar] = useState(false)

  const clampSidebarWidthForWorkspace = useCallback((nextWidth) => {
    const workspaceEl = workspaceRef.current
    if (!workspaceEl) return Math.max(nextWidth, MIN_SIDEBAR_WIDTH)
    return clampSidebarWidth(nextWidth, getWorkspaceContentWidth(workspaceEl))
  }, [])

  const getPendingNav = useCallback(() => pendingNavRef.current, [])
  const setPendingNav = useCallback((value) => {
    pendingNavRef.current = value
  }, [])
  const setDeepLinkFocusGuardValue = useCallback((value) => {
    deepLinkFocusGuardRef.current = value
    setDeepLinkFocusGuard(value)
  }, [])

  const { session, loading, message: authMessage, setMessage: setAuthMessage, signIn, signOut, userId } = useAuth()

  const hydrateContentWithSignedUrls = useContentHydration(session)

  const {
    settingsMode,
    setSettingsMode,
    settingsLoading,
    templateSaveStatus,
    setTemplateSaveStatus,
    settingsContentVersion,
    templateContentRef,
    message: settingsMessage,
    setMessage: setSettingsMessage,
    scheduleSettingsSave,
    openSettings,
    closeSettings,
    openDailyTemplate,
    backToSettingsHub,
  } = useSettings(userId, hydrateContentWithSignedUrls)

  const {
    notebooks,
    activeNotebookId,
    setActiveNotebookId,
    activeNotebook,
    activeNotebookType,
    isRecipesNotebook,
    message: notebookMessage,
    setMessage: setNotebookMessage,
    createNotebook,
    renameNotebook,
    deleteNotebook,
  } = useNotebooks(userId, pendingNavRef, savedSelectionRef)

  const {
    sections,
    sectionsLoading,
    activeSectionId,
    setActiveSectionId,
    message: sectionMessage,
    setMessage: setSectionMessage,
    createSection,
    renameSection,
    deleteSection,
    moveSection,
    copySection,
  } = useSections(userId, activeNotebookId, pendingNavRef, savedSelectionRef)

  const {
    trackers,
    activeTrackerId,
    setActiveTrackerId,
    activeTracker,
    sectionTrackerPage,
    titleDraft,
    saveStatus,
    hasPendingSaves,
    dataLoading,
    trackerPageSaving,
    message: trackerMessage,
    setMessage: setTrackerMessage,
    scheduleSave,
    handleTitleChange,
    createTracker,
    createTrackerWithContent,
    reorderTrackers,
    setTrackerPage,
    deleteTracker,
    draftConflict,
    draftConflictRef,
    resolveConflictWithServer,
    resolveConflictWithDraft,
    flushAllPendingSaves,
  } = useTrackers(userId, activeSectionId, pendingNavRef, savedSelectionRef)

  const {
    navIntentRef,
    hashBlockRef,
    initialNavReady,
    handleInternalHashNavigate,
    clearBlockAnchorIfPresent,
  } = useNavigation({
    session,
    notebooks,
    activeNotebookId,
    activeSectionId,
    activeTrackerId,
    setActiveNotebookId,
    setActiveSectionId,
    setActiveTrackerId,
    getPendingNav,
    setPendingNav,
    setDeepLinkFocusGuard: setDeepLinkFocusGuardValue,
  })

  const message = authMessage || notebookMessage || sectionMessage || trackerMessage || settingsMessage
  const isSaving = hasPendingSaves || templateSaveStatus === 'Saving...'
  const activeSection = sections.find((section) => section.id === activeSectionId) ?? null

  const [treeContextMenu, setTreeContextMenu] = useState({
    open: false,
    x: 0,
    y: 0,
    type: null,
    item: null,
  })
  const [copyMoveModal, setCopyMoveModal] = useState({ open: false, action: null, section: null, destId: '' })

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth
  }, [sidebarWidth])

  useEffect(() => {
    const syncViewport = () => {
      setIsMobileViewport(window.innerWidth <= MOBILE_BREAKPOINT_PX)
    }
    syncViewport()
    window.addEventListener('resize', syncViewport)
    return () => window.removeEventListener('resize', syncViewport)
  }, [])

  useEffect(() => {
    const syncSidebarWidth = () => {
      setSidebarWidth((prev) => clampSidebarWidthForWorkspace(prev))
    }
    syncSidebarWidth()
    window.addEventListener('resize', syncSidebarWidth)
    return () => window.removeEventListener('resize', syncSidebarWidth)
  }, [clampSidebarWidthForWorkspace])

  useEffect(() => {
    if (!treeContextMenu.open) return
    const handleMouseDown = (event) => {
      if (!(event.target instanceof Element) || !event.target.closest('.tree-context-menu')) {
        setTreeContextMenu((prev) => ({ ...prev, open: false }))
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [treeContextMenu.open])

  useEffect(() => {
    if (!treeContextMenu.open) return
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setTreeContextMenu((prev) => ({ ...prev, open: false }))
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [treeContextMenu.open])

  useEffect(() => {
    if (!isMobileViewport) {
      setMobileSidebarOpen(false)
    }
  }, [isMobileViewport])

  const handleCopyMoveConfirm = async () => {
    const { action, section, destId } = copyMoveModal
    if (!destId) return
    setCopyMoveModal({ open: false, action: null, section: null, destId: '' })
    if (action === 'move') {
      const moved = await moveSection(section, destId)
      if (moved) {
        navIntentRef.current = 'push'
        hashBlockRef.current = null
        pendingNavRef.current = null
        setActiveNotebookId(destId)
      }
    } else {
      await copySection(section, destId, session)
    }
  }

  const confirmLeaveWhileSaving = useCallback(() => {
    if (!isSaving) return true
    return window.confirm('Changes are still saving. Leave this page anyway?')
  }, [isSaving])
  const handleAppPointerDownCapture = useCallback(
    (event) => {
      const target = event.target
      if (!(target instanceof Element)) {
        pointerGestureRef.current = null
        return
      }
      const isInternalLink = Boolean(
        target.closest('a[href^="#pg="], a[href^="#sec="], a[href^="#nb="]'),
      )
      const isEditorContent = Boolean(target.closest('.ProseMirror'))
      pointerGestureRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        isInternalLink,
        isEditorContent,
      }
    },
    [],
  )
  const handleAppPointerUpCapture = useCallback(
    (event) => {
      const gesture = pointerGestureRef.current
      if (!gesture || gesture.pointerId !== event.pointerId) return
      pointerGestureRef.current = null
      if (gesture.isInternalLink) return
      const moved =
        Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) >
        POINTER_TAP_DISTANCE_PX
      if (moved) {
        pendingEditTapRef.current = null
        return
      }
      if (deepLinkFocusGuardRef.current) {
        pendingEditTapRef.current = {
          left: event.clientX,
          top: event.clientY,
          inEditor: gesture.isEditorContent,
        }
      } else {
        pendingEditTapRef.current = null
      }
      if (gesture.isEditorContent) {
        suppressFocusRef.current = false
      }
      clearBlockAnchorIfPresent()
    },
    [clearBlockAnchorIfPresent],
  )
  const handleAppPointerCancelCapture = useCallback(() => {
    pointerGestureRef.current = null
    pendingEditTapRef.current = null
  }, [])
  const handleAppKeyDownCapture = useCallback(
    (event) => {
      if (event.isComposing) return
      if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') return
      const target = event.target
      if (target instanceof Element && target.closest('a[href^="#pg="], a[href^="#sec="], a[href^="#nb="]')) return
      clearBlockAnchorIfPresent()
    },
    [clearBlockAnchorIfPresent],
  )
  const setMessage = (msg) => {
    setAuthMessage(msg)
    setNotebookMessage(msg)
    setSectionMessage(msg)
    setTrackerMessage(msg)
    setSettingsMessage(msg)
  }

  const uploadImageRef = useRef(null)

  const { editor, editorLocked, suppressFocusRef } = useEditorSetup({
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
    onNavigateHash: handleInternalHashNavigate,
    uploadImageRef,
    deepLinkFocusGuard,
    deepLinkFocusGuardRef,
  })

  const finalUploadImageAndInsert = useImageUpload(session, editor, setMessage)

  useEffect(() => {
    uploadImageRef.current = finalUploadImageAndInsert
  }, [finalUploadImageAndInsert])

  useEffect(() => {
    if (!session || !initialNavReady) return
    const savedSelection = savedSelectionRef.current
    if (savedSelection?.notebookId && !activeNotebookId) return
    if (
      activeNotebookId &&
      savedSelection?.notebookId === activeNotebookId &&
      savedSelection.sectionId &&
      !activeSectionId &&
      (sectionsLoading || sections.length > 0)
    ) {
      return
    }
    if (
      activeSectionId &&
      savedSelection?.sectionId === activeSectionId &&
      savedSelection.pageId &&
      !activeTrackerId &&
      (dataLoading || trackers.length > 0)
    ) {
      return
    }
    if (activeNotebookId && sectionsLoading) return
    if (activeSectionId && dataLoading) return
    saveSelection(activeNotebookId, activeSectionId, activeTrackerId)
    savedSelectionRef.current = { notebookId: activeNotebookId, sectionId: activeSectionId, pageId: activeTrackerId }
  }, [
    session,
    initialNavReady,
    activeNotebookId,
    activeSectionId,
    activeTrackerId,
    sectionsLoading,
    dataLoading,
    sections.length,
    trackers.length,
  ])

  useEffect(() => {
    if (settingsMode !== 'daily-template') return
    setTemplateSaveStatus('Saved')
  }, [settingsMode, setTemplateSaveStatus])

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      flushAllPendingSaves()
      if (!isSaving) return
      event.preventDefault()
      event.returnValue = ''
    }
    // visibilitychange fires when user switches tabs or apps (primary mobile fix).
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushAllPendingSaves()
      }
    }
    // pagehide is a backup — fires when the page is being unloaded/destroyed.
    const handlePageHide = () => {
      flushAllPendingSaves()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', handlePageHide)
    }
  }, [isSaving, flushAllPendingSaves])

  const handleSignOut = async () => {
    if (!confirmLeaveWhileSaving()) return
    await signOut()
    clearNavHierarchyCache()
    setMessage('')
    setActiveNotebookId(null)
    setActiveSectionId(null)
    setActiveTrackerId(null)
    setSettingsMode(null)
    setDeepLinkFocusGuardValue(false)
    pendingNavRef.current = null
  }

  const handleNotebookSelect = (nextNotebookId) => {
    if (settingsMode) {
      setSettingsMode(null)
    }
    navIntentRef.current = 'push'
    hashBlockRef.current = null
    setDeepLinkFocusGuardValue(false)
    pendingNavRef.current = null
    suppressFocusRef.current = true
    if (isTouchOnlyDevice() && editor && !editor.isDestroyed) {
      editor.view.dom.blur()
    }
    setActiveNotebookId(nextNotebookId)
  }

  const handleSectionSelect = (sectionId) => {
    if (settingsMode) {
      setSettingsMode(null)
    }
    navIntentRef.current = 'push'
    hashBlockRef.current = null
    setDeepLinkFocusGuardValue(false)
    pendingNavRef.current = null
    suppressFocusRef.current = true
    if (isTouchOnlyDevice() && editor && !editor.isDestroyed) {
      editor.view.dom.blur()
    }
    setActiveSectionId(sectionId)
  }

  const handlePageSelect = (trackerId) => {
    if (settingsMode) {
      setSettingsMode(null)
    }
    navIntentRef.current = 'push'
    hashBlockRef.current = null
    setDeepLinkFocusGuardValue(false)
    pendingNavRef.current = null
    suppressFocusRef.current = true
    if (isTouchOnlyDevice() && editor && !editor.isDestroyed) {
      editor.view.dom.blur()
    }
    setActiveTrackerId(trackerId)
    if (isMobileViewport) {
      setMobileSidebarOpen(false)
    }
  }

  const handleOpenTreeContextMenu = (event, type, item) => {
    event.preventDefault()
    setTreeContextMenu({ open: true, x: event.clientX, y: event.clientY, type, item })
  }

  const closeTreeContextMenu = () => {
    setTreeContextMenu((prev) => ({ ...prev, open: false }))
  }

  const openCopyMoveModal = (action) => {
    setCopyMoveModal({ open: true, action, section: treeContextMenu.item, destId: '' })
  }

  const closeCopyMoveModal = () => {
    setCopyMoveModal({ open: false, action: null, section: null, destId: '' })
  }

  const handleToggleSidebar = () => {
    if (isMobileViewport) {
      setMobileSidebarOpen((prev) => !prev)
      return
    }

    setSidebarCollapsed((prev) => {
      const next = !prev
      saveStoredSidebarCollapsed(next)
      return next
    })
  }

  const handleSidebarResizeStart = useCallback(
    (event) => {
      if (isMobileViewport || sidebarCollapsed) return
      if (typeof event.button === 'number' && event.button !== 0) return
      const workspaceEl = workspaceRef.current
      if (!workspaceEl) return

      event.preventDefault()
      resizeStateRef.current = {
        startX: event.clientX,
        startWidth: sidebarWidthRef.current,
      }
      setIsResizingSidebar(true)
    },
    [isMobileViewport, sidebarCollapsed],
  )

  const handleSidebarResizeKeyDown = useCallback(
    (event) => {
      if (isMobileViewport || sidebarCollapsed) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      const delta = event.key === 'ArrowRight' ? 24 : -24
      setSidebarWidth((prev) => {
        const next = clampSidebarWidthForWorkspace(prev + delta)
        saveStoredSidebarWidth(next)
        return next
      })
    },
    [clampSidebarWidthForWorkspace, isMobileViewport, sidebarCollapsed],
  )

  useEffect(() => {
    if (!isResizingSidebar) return

    const handlePointerMove = (event) => {
      const resizeState = resizeStateRef.current
      if (!resizeState) return
      const deltaX = event.clientX - resizeState.startX
      const rawWidth = resizeState.startWidth + deltaX
      setSidebarWidth(clampSidebarWidthForWorkspace(rawWidth))
    }

    const stopResizing = () => {
      resizeStateRef.current = null
      setIsResizingSidebar(false)
      saveStoredSidebarWidth(sidebarWidthRef.current)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)
    window.addEventListener('pointercancel', stopResizing)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
      window.removeEventListener('pointercancel', stopResizing)
    }
  }, [isResizingSidebar, clampSidebarWidthForWorkspace])

  const isSettingsHub = settingsMode === 'hub'
  const isTemplateEditing = settingsMode === 'daily-template'
  const compactBadges = sidebarWidth < SIDEBAR_BADGE_COMPACT_WIDTH
  const isSidebarOpen = isMobileViewport ? mobileSidebarOpen : !sidebarCollapsed
  const workspaceClassName = [
    'workspace',
    !isMobileViewport && sidebarCollapsed ? 'sidebar-collapsed' : '',
    isResizingSidebar ? 'sidebar-resizing' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const workspaceStyle = { '--sidebar-width': `${sidebarWidth}px` }
  const breadcrumbNotebookTitle = activeNotebook?.title
  const breadcrumbSectionTitle = settingsMode ? 'Settings' : activeSection?.title
  const breadcrumbPageTitle = isSettingsHub
    ? 'Settings'
    : isTemplateEditing
      ? 'Daily Template'
      : titleDraft || activeTracker?.title
  const mobileBreadcrumbTitle = isSettingsHub
    ? 'Settings'
    : isTemplateEditing
      ? 'Daily Template'
      : titleDraft || activeTracker?.title || activeSection?.title || activeNotebook?.title || 'Life Tracker'

  if (missingEnv) {
    return (
      <div className="app">
        <h1>Life Tracker</h1>
        <div className="card">
          <p>Missing Supabase environment variables.</p>
          <p>
            Set these in a <code>.env.local</code> file, then restart the dev server:
          </p>
          <ul>
            <li>VITE_SUPABASE_URL</li>
            <li>VITE_SUPABASE_ANON_KEY</li>
          </ul>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="app">
        <h1>Life Tracker</h1>
        <div className="card">Loading...</div>
      </div>
    )
  }

  if (!session) {
    return <AuthForm onSignIn={signIn} message={message} />
  }

  if (notebooks.length === 0) {
    return <WelcomeScreen session={session} onCreateNotebook={() => createNotebook(session)} onSignOut={handleSignOut} />
  }

  return (
    <div
      className="app"
      onPointerDownCapture={handleAppPointerDownCapture}
      onPointerUpCapture={handleAppPointerUpCapture}
      onPointerCancelCapture={handleAppPointerCancelCapture}
      onKeyDownCapture={handleAppKeyDownCapture}
    >
      <SlimHeader
        notebookTitle={breadcrumbNotebookTitle}
        sectionTitle={isTemplateEditing ? 'Settings' : settingsMode ? null : breadcrumbSectionTitle}
        pageTitle={breadcrumbPageTitle}
        mobileTitle={mobileBreadcrumbTitle}
        settingsActive={Boolean(settingsMode)}
        sidebarOpen={isSidebarOpen}
        onToggleSidebar={handleToggleSidebar}
        onOpenSettings={openSettings}
        onSignOut={handleSignOut}
      />
      {isMobileViewport && isSidebarOpen ? (
        <button
          type="button"
          className="drawer-backdrop"
          aria-label="Close navigation drawer"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => setMobileSidebarOpen(false)}
        />
      ) : null}

      <div ref={workspaceRef} className={workspaceClassName} style={workspaceStyle}>
        <NavigationTree
          className={`${isSidebarOpen ? 'open' : ''} ${sidebarCollapsed ? 'collapsed' : ''}`}
          notebooks={notebooks}
          sections={sections}
          trackers={trackers}
          activeNotebookId={activeNotebookId}
          activeSectionId={activeSectionId}
          activeTrackerId={activeTrackerId}
          loading={dataLoading}
          compactBadges={compactBadges}
          isRecipesNotebook={isRecipesNotebook}
          session={session}
          onSelectNotebook={handleNotebookSelect}
          onSelectSection={handleSectionSelect}
          onSelectPage={handlePageSelect}
          onCreateNotebook={() => createNotebook(session)}
          onCreateSection={() => createSection(session, activeNotebookId)}
          onCreatePage={() => createTracker(session, activeSectionId)}
          onReorderPages={reorderTrackers}
          onOpenContextMenu={handleOpenTreeContextMenu}
          onCreateWithContent={(title, content) =>
            createTrackerWithContent(session, activeSectionId, title, content)
          }
        />
        <div
          className="sidebar-resizer"
          role="separator"
          aria-label="Resize navigation sidebar"
          aria-orientation="vertical"
          tabIndex={sidebarCollapsed || isMobileViewport ? -1 : 0}
          onPointerDown={handleSidebarResizeStart}
          onKeyDown={handleSidebarResizeKeyDown}
        />
        {isSettingsHub && (
          <SettingsHub
            onEditDailyTemplate={openDailyTemplate}
            onBackToPages={closeSettings}
            loading={settingsLoading}
          />
        )}
        {isTemplateEditing && (
          <EditorPanel
            editor={editor}
            editorLocked={editorLocked}
            title="Daily Template"
            onTitleChange={() => {}}
            onDelete={() => {}}
            saveStatus={templateSaveStatus}
            onImageUpload={finalUploadImageAndInsert}
            hasTracker
            message={message}
            notebookId={activeNotebookId}
            sectionId={activeSectionId}
            trackerId={activeTrackerId}
            onNavigateHash={handleInternalHashNavigate}
            allTrackers={trackers}
            userId={userId}
            titleReadOnly
            showDelete={false}
            headerActions={
              <button type="button" className="ghost" onClick={() => backToSettingsHub()}>
                Back to Settings
              </button>
            }
            showAiDaily={false}
            showAiInsert={false}
          />
        )}
        {!settingsMode && (
          <>
            <EditorPanel
              editor={editor}
              editorLocked={editorLocked}
              title={titleDraft}
              onTitleChange={(value) => handleTitleChange(value, editor)}
              onDelete={deleteTracker}
              saveStatus={saveStatus}
              onImageUpload={finalUploadImageAndInsert}
              hasTracker={!!activeTracker}
              message={message}
              notebookId={activeNotebookId}
              sectionId={activeSectionId}
              trackerId={activeTrackerId}
              onNavigateHash={handleInternalHashNavigate}
              allTrackers={trackers}
              trackerSourcePage={sectionTrackerPage}
              onSetTrackerPage={setTrackerPage}
              trackerPageSaving={trackerPageSaving}
              userId={userId}
            />
          </>
        )}
      </div>
      <TreeContextMenu
        menu={treeContextMenu}
        onRename={() => {
          closeTreeContextMenu()
          if (treeContextMenu.type === 'notebook') {
            renameNotebook(treeContextMenu.item)
          } else if (treeContextMenu.type === 'section') {
            renameSection(treeContextMenu.item)
          }
        }}
        onDelete={() => {
          closeTreeContextMenu()
          if (treeContextMenu.type === 'notebook') {
            deleteNotebook(treeContextMenu.item)
          } else if (treeContextMenu.type === 'section') {
            deleteSection(treeContextMenu.item)
          } else if (treeContextMenu.type === 'page') {
            deleteTracker(treeContextMenu.item)
          }
        }}
        onCopy={() => {
          closeTreeContextMenu()
          openCopyMoveModal('copy')
        }}
        onMove={() => {
          closeTreeContextMenu()
          openCopyMoveModal('move')
        }}
      />
      <CopyMoveModal
        modal={copyMoveModal}
        notebooks={notebooks}
        activeNotebookId={activeNotebookId}
        onDestChange={(destId) => setCopyMoveModal((prev) => ({ ...prev, destId }))}
        onClose={closeCopyMoveModal}
        onConfirm={handleCopyMoveConfirm}
      />
      <ConflictModal
        conflict={draftConflict}
        onUseServer={() => {
          // Read from ref so the handler always sees the live conflict value,
          // not a stale closure from a prior render.
          const serverContent = draftConflictRef.current?.serverContent
          resolveConflictWithServer()
          if (editor && serverContent) {
            editor.commands.setContent(serverContent, { emitUpdate: false })
          }
        }}
        onUseDraft={() => {
          const draftContent = draftConflictRef.current?.draftContent
          resolveConflictWithDraft()
          if (editor && draftContent) {
            editor.commands.setContent(draftContent, { emitUpdate: false })
          }
        }}
      />
    </div>
  )
}

export default App
