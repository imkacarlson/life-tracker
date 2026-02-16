import { useCallback, useEffect, useRef } from 'react'
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
import './App.css'

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
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand">
            <h1>Life Tracker</h1>
            <p className="subtle">Signed in as {session.user.email}</p>
          </div>
          <div className="notebook-switcher">
            <label className="subtle">Notebook</label>
            <select
              value={activeNotebookId ?? ''}
              onChange={(event) => {
                const nextNotebookId = event.target.value
                if (settingsMode) {
                  setSettingsMode(null)
                }
                navIntentRef.current = 'push'
                hashBlockRef.current = null
                pendingNavRef.current = null
                setActiveNotebookId(nextNotebookId)
              }}
            >
              {notebooks.map((notebook) => (
                <option key={notebook.id} value={notebook.id}>
                  {notebook.title}
                </option>
              ))}
            </select>
            <button className="ghost" onClick={() => createNotebook(session)}>
              New
            </button>
            <button className="ghost" onClick={() => renameNotebook(activeNotebook)} disabled={!activeNotebook}>
              Rename
            </button>
            <button className="ghost" onClick={() => deleteNotebook(activeNotebook)} disabled={!activeNotebook}>
              Delete
            </button>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className={`ghost settings-button ${settingsMode ? 'active' : ''}`}
            onClick={() => openSettings()}
          >
            Settings
          </button>
          <button className="secondary" onClick={handleSignOut}>
            Log out
          </button>
        </div>
      </header>

      <div className="section-tabs">
        {sections.map((section) => (
          <div
            key={section.id}
            role="button"
            tabIndex={0}
            className={`section-tab ${section.id === activeSectionId ? 'active' : ''}`}
            style={{ backgroundColor: section.color || '#eef2ff' }}
            onClick={() => {
              if (settingsMode) {
                setSettingsMode(null)
              }
              navIntentRef.current = 'push'
              hashBlockRef.current = null
              pendingNavRef.current = null
              setActiveSectionId(section.id)
            }}
            onDoubleClick={() => renameSection(section)}
            onContextMenu={(event) => {
              event.preventDefault()
              renameSection(section)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                if (settingsMode) {
                  setSettingsMode(null)
                }
                navIntentRef.current = 'push'
                hashBlockRef.current = null
                pendingNavRef.current = null
                setActiveSectionId(section.id)
              }
            }}
          >
            <span>{section.title}</span>
            <button
              type="button"
              className="tab-delete"
              onClick={(event) => {
                event.stopPropagation()
                deleteSection(section)
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button
          className="section-add"
          onClick={() => createSection(session, activeNotebookId)}
          disabled={!activeNotebookId}
        >
          +
        </button>
      </div>

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
    </div>
  )
}

export default App
