import { useEffect, useRef } from 'react'
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

  const pendingNavRef = useRef(null)

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
    activeSection,
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
    titleDraft,
    saveStatus,
    setSaveStatus,
    setTemplateSaveStatus: setTrackerTemplateSaveStatus,
    dataLoading,
    message: trackerMessage,
    setMessage: setTrackerMessage,
    scheduleSave,
    handleTitleChange,
    createTracker,
    reorderTrackers,
    deleteTracker,
    activeTrackerRef,
  } = useTrackers(userId, activeSectionId, pendingNavRef, savedSelectionRef)

  const {
    pendingNavRef: navPendingRef,
    navIntentRef,
    hashBlockRef,
    navigateRef,
    handleInternalHashNavigate,
  } = useNavigation({
    session,
    notebooks,
    activeNotebookId,
    activeSectionId,
    activeTrackerId,
    setActiveNotebookId,
    setActiveSectionId,
    setActiveTrackerId,
  })

  useEffect(() => {
    pendingNavRef.current = navPendingRef.current
  }, [navPendingRef])

  const message = authMessage || notebookMessage || sectionMessage || trackerMessage || settingsMessage
  const setMessage = (msg) => {
    setAuthMessage(msg)
    setNotebookMessage(msg)
    setSectionMessage(msg)
    setTrackerMessage(msg)
    setSettingsMessage(msg)
  }

  const uploadImageRef = useRef(null)
  const uploadImageAndInsert = useImageUpload(session, null, setMessage)

  const editor = useEditorSetup({
    session,
    activeTrackerId,
    activeTracker,
    settingsMode,
    settingsContentVersion,
    templateContentRef,
    hydrateContentWithSignedUrls,
    scheduleSave,
    scheduleSettingsSave,
    pendingNavRef: navPendingRef,
    navigateRef,
    uploadImageRef,
  })

  const finalUploadImageAndInsert = useImageUpload(session, editor, setMessage)

  useEffect(() => {
    uploadImageRef.current = finalUploadImageAndInsert
  }, [finalUploadImageAndInsert])

  useEffect(() => {
    if (!session) return
    saveSelection(activeNotebookId, activeSectionId, activeTrackerId)
    savedSelectionRef.current = { notebookId: activeNotebookId, sectionId: activeSectionId, pageId: activeTrackerId }
  }, [session, activeNotebookId, activeSectionId, activeTrackerId])

  useEffect(() => {
    if (settingsMode) return
    if (activeTracker) {
      // Title is already managed by useTrackers
    }
    setSaveStatus('Saved')
  }, [activeTrackerId, activeTracker, settingsMode, setSaveStatus])

  useEffect(() => {
    if (settingsMode !== 'daily-template') return
    setTemplateSaveStatus('Saved')
  }, [settingsMode, setTemplateSaveStatus])

  const handleSignOut = async () => {
    await signOut()
    setActiveNotebookId(null)
    setActiveSectionId(null)
    setActiveTrackerId(null)
    setSettingsMode(null)
    pendingNavRef.current = null
    navPendingRef.current = null
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
    <div className="app">
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
                if (settingsMode) {
                  setSettingsMode(null)
                }
                navIntentRef.current = 'push'
                hashBlockRef.current = null
                navPendingRef.current = null
                setActiveNotebookId(event.target.value)
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
            onClick={openSettings}
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
              navPendingRef.current = null
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
                navPendingRef.current = null
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
        <button className="section-add" onClick={() => createSection(session, activeNotebookId)} disabled={!activeNotebookId}>
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
              <button type="button" className="ghost" onClick={backToSettingsHub}>
                Back to Settings
              </button>
            }
            showAiDaily={false}
          />
        )}
        {!settingsMode && (
          <>
            <EditorPanel
              editor={editor}
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
              userId={userId}
            />
            <Sidebar
              trackers={trackers}
              activeId={activeTrackerId}
              onSelect={(id) => {
                navIntentRef.current = 'push'
                hashBlockRef.current = null
                navPendingRef.current = null
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
