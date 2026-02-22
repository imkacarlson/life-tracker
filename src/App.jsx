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
import {
  saveSelection,
  readStoredSelection,
  readStoredSidebarWidth,
  saveStoredSidebarWidth,
} from './utils/storage'
import Sidebar from './components/Sidebar'
import EditorPanel from './components/EditorPanel'
import SettingsHub from './components/SettingsHub'
import AuthForm from './components/AuthForm'
import WelcomeScreen from './components/WelcomeScreen'
import TopBar from './components/app/TopBar'
import SectionTabs from './components/app/SectionTabs'
import SectionContextMenu from './components/app/SectionContextMenu'
import CopyMoveModal from './components/app/CopyMoveModal'
import './styles/index.css'

const DEFAULT_SIDEBAR_WIDTH = 280
const MIN_SIDEBAR_WIDTH = 220
const MIN_EDITOR_WIDTH = 520
const SIDEBAR_RESIZER_WIDTH = 14
const SIDEBAR_BADGE_COMPACT_WIDTH = 300
const POINTER_TAP_DISTANCE_PX = 10

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
  const deepLinkFocusGuardRef = useRef(false)
  const pointerGestureRef = useRef(null)
  const workspaceRef = useRef(null)
  const resizeStateRef = useRef(null)
  const sidebarWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH)
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readStoredSidebarWidth(DEFAULT_SIDEBAR_WIDTH),
  )
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
    message: notebookMessage,
    setMessage: setNotebookMessage,
    createNotebook,
    renameNotebook,
    deleteNotebook,
  } = useNotebooks(userId, pendingNavRef, savedSelectionRef)

  const {
    sections,
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
    reorderTrackers,
    setTrackerPage,
    deleteTracker,
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
    deepLinkFocusGuardRef,
  })

  const message = authMessage || notebookMessage || sectionMessage || trackerMessage || settingsMessage
  const isSaving = hasPendingSaves || templateSaveStatus === 'Saving...'

  const [sectionMenu, setSectionMenu] = useState({ open: false, x: 0, y: 0, section: null })
  const [copyMoveModal, setCopyMoveModal] = useState({ open: false, action: null, section: null, destId: '' })

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth
  }, [sidebarWidth])

  useEffect(() => {
    const syncSidebarWidth = () => {
      setSidebarWidth((prev) => clampSidebarWidthForWorkspace(prev))
    }
    syncSidebarWidth()
    window.addEventListener('resize', syncSidebarWidth)
    return () => window.removeEventListener('resize', syncSidebarWidth)
  }, [clampSidebarWidthForWorkspace])

  useEffect(() => {
    if (!sectionMenu.open) return
    const handleMouseDown = (event) => {
      if (!event.target.closest('.section-context-menu')) {
        setSectionMenu((prev) => ({ ...prev, open: false }))
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [sectionMenu.open])

  useEffect(() => {
    if (!sectionMenu.open) return
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setSectionMenu((prev) => ({ ...prev, open: false }))
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [sectionMenu.open])

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
      pointerGestureRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        isInternalLink,
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
      if (moved) return
      deepLinkFocusGuardRef.current = false
      clearBlockAnchorIfPresent()
    },
    [clearBlockAnchorIfPresent],
  )
  const handleAppPointerCancelCapture = useCallback(() => {
    pointerGestureRef.current = null
  }, [])
  const handleAppKeyDownCapture = useCallback(
    (event) => {
      if (event.isComposing) return
      if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') return
      const target = event.target
      if (target instanceof Element && target.closest('a[href^="#pg="], a[href^="#sec="], a[href^="#nb="]')) return
      deepLinkFocusGuardRef.current = false
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

  const { editor, editorLocked } = useEditorSetup({
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
    onNavigateHash: handleInternalHashNavigate,
    uploadImageRef,
    deepLinkFocusGuardRef,
  })

  const finalUploadImageAndInsert = useImageUpload(session, editor, setMessage)

  useEffect(() => {
    uploadImageRef.current = finalUploadImageAndInsert
  }, [finalUploadImageAndInsert])

  useEffect(() => {
    if (!session || !initialNavReady) return
    saveSelection(activeNotebookId, activeSectionId, activeTrackerId)
    savedSelectionRef.current = { notebookId: activeNotebookId, sectionId: activeSectionId, pageId: activeTrackerId }
  }, [session, initialNavReady, activeNotebookId, activeSectionId, activeTrackerId])

  useEffect(() => {
    if (settingsMode !== 'daily-template') return
    setTemplateSaveStatus('Saved')
  }, [settingsMode, setTemplateSaveStatus])

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!isSaving) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isSaving])

  const handleSignOut = async () => {
    if (!confirmLeaveWhileSaving()) return
    await signOut()
    setMessage('')
    setActiveNotebookId(null)
    setActiveSectionId(null)
    setActiveTrackerId(null)
    setSettingsMode(null)
    deepLinkFocusGuardRef.current = false
    pendingNavRef.current = null
  }

  const handleNotebookSelect = (nextNotebookId) => {
    if (settingsMode) {
      setSettingsMode(null)
    }
    navIntentRef.current = 'push'
    hashBlockRef.current = null
    deepLinkFocusGuardRef.current = false
    pendingNavRef.current = null
    setActiveNotebookId(nextNotebookId)
  }

  const handleSectionSelect = (sectionId) => {
    if (settingsMode) {
      setSettingsMode(null)
    }
    navIntentRef.current = 'push'
    hashBlockRef.current = null
    deepLinkFocusGuardRef.current = false
    pendingNavRef.current = null
    setActiveSectionId(sectionId)
  }

  const handleOpenSectionMenu = (event, section) => {
    event.preventDefault()
    setSectionMenu({ open: true, x: event.clientX, y: event.clientY, section })
  }

  const closeSectionMenu = () => {
    setSectionMenu((prev) => ({ ...prev, open: false }))
  }

  const openCopyMoveModal = (action) => {
    setCopyMoveModal({ open: true, action, section: sectionMenu.section, destId: '' })
  }

  const closeCopyMoveModal = () => {
    setCopyMoveModal({ open: false, action: null, section: null, destId: '' })
  }

  const handleSidebarResizeStart = useCallback(
    (event) => {
      if (settingsMode) return
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
    [settingsMode],
  )

  const handleSidebarResizeKeyDown = useCallback(
    (event) => {
      if (settingsMode) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      const delta = event.key === 'ArrowLeft' ? 24 : -24
      setSidebarWidth((prev) => {
        const next = clampSidebarWidthForWorkspace(prev + delta)
        saveStoredSidebarWidth(next)
        return next
      })
    },
    [clampSidebarWidthForWorkspace, settingsMode],
  )

  useEffect(() => {
    if (!isResizingSidebar) return

    const handlePointerMove = (event) => {
      const resizeState = resizeStateRef.current
      if (!resizeState) return
      const deltaX = event.clientX - resizeState.startX
      const rawWidth = resizeState.startWidth - deltaX
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
  const workspaceClassName = `workspace ${settingsMode ? 'settings-mode' : ''} ${
    isResizingSidebar ? 'sidebar-resizing' : ''
  }`
  const workspaceStyle = settingsMode ? undefined : { '--sidebar-width': `${sidebarWidth}px` }

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
      <TopBar
        session={session}
        notebooks={notebooks}
        activeNotebook={activeNotebook}
        activeNotebookId={activeNotebookId}
        settingsMode={settingsMode}
        onNotebookChange={handleNotebookSelect}
        onCreateNotebook={() => createNotebook(session)}
        onRenameNotebook={() => renameNotebook(activeNotebook)}
        onDeleteNotebook={() => deleteNotebook(activeNotebook)}
        onOpenSettings={openSettings}
        onSignOut={handleSignOut}
      />
      <SectionTabs
        sections={sections}
        activeSectionId={activeSectionId}
        activeNotebookId={activeNotebookId}
        onSelectSection={handleSectionSelect}
        onRenameSection={renameSection}
        onDeleteSection={deleteSection}
        onOpenContextMenu={handleOpenSectionMenu}
        onCreateSection={() => createSection(session, activeNotebookId)}
      />

      <div ref={workspaceRef} className={workspaceClassName} style={workspaceStyle}>
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
            <div
              className="sidebar-resizer"
              role="separator"
              aria-label="Resize pages sidebar"
              aria-orientation="vertical"
              tabIndex={0}
              onPointerDown={handleSidebarResizeStart}
              onKeyDown={handleSidebarResizeKeyDown}
            />
            <Sidebar
              trackers={trackers}
              activeId={activeTrackerId}
              onSelect={(id) => {
                navIntentRef.current = 'push'
                hashBlockRef.current = null
                deepLinkFocusGuardRef.current = false
                pendingNavRef.current = null
                setActiveTrackerId(id)
              }}
              onCreate={() => createTracker(session, activeSectionId)}
              onReorder={reorderTrackers}
              loading={dataLoading}
              disabled={!activeSectionId}
              compactBadges={compactBadges}
            />
          </>
        )}
      </div>
      <SectionContextMenu
        menu={sectionMenu}
        onRename={() => {
          closeSectionMenu()
          renameSection(sectionMenu.section)
        }}
        onCopy={() => {
          closeSectionMenu()
          openCopyMoveModal('copy')
        }}
        onMove={() => {
          closeSectionMenu()
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
    </div>
  )
}

export default App
