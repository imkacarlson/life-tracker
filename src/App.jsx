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
import { saveSelection, readStoredSelection } from './utils/storage'
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

function App() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  const missingEnv = !supabaseUrl || !supabaseAnonKey

  const savedSelectionRef = useRef(readStoredSelection())
  const pendingNavRef = useRef(null)
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
  })

  const message = authMessage || notebookMessage || sectionMessage || trackerMessage || settingsMessage
  const isSaving = hasPendingSaves || templateSaveStatus === 'Saving...'

  const [sectionMenu, setSectionMenu] = useState({ open: false, x: 0, y: 0, section: null })
  const [copyMoveModal, setCopyMoveModal] = useState({ open: false, action: null, section: null, destId: '' })

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
      if (!(target instanceof Element)) return
      if (target.closest('a[href^="#pg="], a[href^="#sec="], a[href^="#nb="]')) return
      clearBlockAnchorIfPresent()
    },
    [clearBlockAnchorIfPresent],
  )
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
    pendingNavRef.current = null
  }

  const handleNotebookSelect = (nextNotebookId) => {
    if (settingsMode) {
      setSettingsMode(null)
    }
    navIntentRef.current = 'push'
    hashBlockRef.current = null
    pendingNavRef.current = null
    setActiveNotebookId(nextNotebookId)
  }

  const handleSectionSelect = (sectionId) => {
    if (settingsMode) {
      setSettingsMode(null)
    }
    navIntentRef.current = 'push'
    hashBlockRef.current = null
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

  const isSettingsHub = settingsMode === 'hub'
  const isTemplateEditing = settingsMode === 'daily-template'

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
    <div className="app" onPointerDownCapture={handleAppPointerDownCapture} onKeyDownCapture={handleAppKeyDownCapture}>
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

      <div className={`workspace ${settingsMode ? 'settings-mode' : ''}`}>
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
            <Sidebar
              trackers={trackers}
              activeId={activeTrackerId}
              onSelect={(id) => {
                navIntentRef.current = 'push'
                hashBlockRef.current = null
                pendingNavRef.current = null
                setActiveTrackerId(id)
              }}
              onCreate={() => createTracker(session, activeSectionId)}
              onReorder={reorderTrackers}
              loading={dataLoading}
              disabled={!activeSectionId}
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
