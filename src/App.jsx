import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from './hooks/useAuth'
import { useNotebooks } from './hooks/useNotebooks'
import { useSections } from './hooks/useSections'
import { usePages } from './hooks/usePages'
import { useSettings } from './hooks/useSettings'
import { useNavigation } from './hooks/useNavigation'
import { useNavigationHistory } from './hooks/useNavigationHistory'
import { useContentHydration } from './hooks/useContentHydration'
import { useImageUpload } from './hooks/useImageUpload'
import { useEditorSetup } from './hooks/useEditorSetup'
import { useCustomDictionary } from './hooks/useCustomDictionary'
import { useEditorSession } from './hooks/useEditorSession'
import { useResumeRefresh } from './hooks/useResumeRefresh'
import { useSaveLifecycle } from './components/app/hooks/useSaveLifecycle'
import { useSidebarLayout } from './components/app/hooks/useSidebarLayout'
import { clearNavHierarchyCache } from './utils/resolveNavHierarchy'
import { isTouchOnlyDevice } from './utils/device'
import { getMountedEditorView } from './utils/editorView'
import { registerDeepLinkSelectionApplier } from './utils/navigationHelpers'
import { applyDeepLinkSelection } from './utils/deepLinkSelection'
import { pickPostDeleteTarget } from './utils/navigationHistoryHelpers'
import { SECTION_PAGE_STATUS, getSectionPageEntry } from './utils/sectionPages'
import { useNavigationSelectionStore } from './stores/navigationSelectionStore'
import AuthForm from './components/AuthForm'
import WelcomeScreen from './components/WelcomeScreen'
import Workspace from './components/app/Workspace'
import './styles/index.css'

const POINTER_TAP_DISTANCE_PX = 10

function App() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  const missingEnv = !supabaseUrl || !supabaseAnonKey

  const pendingEditTapRef = useRef(null)
  const touchNavigationGuardRef = useRef(false)
  const deepLinkFocusGuardRef = useRef(false)
  const [touchNavigationGuard, setTouchNavigationGuard] = useState(false)
  const [deepLinkFocusGuard, setDeepLinkFocusGuard] = useState(false)
  const pointerGestureRef = useRef(null)
  const {
    workspaceRef,
    isMobileViewport,
    sidebarCollapsed,
    mobileSidebarOpen,
    setMobileSidebarOpen,
    isSidebarOpen,
    compactBadges,
    workspaceClassName,
    workspaceStyle,
    handleToggleSidebar,
    handleSidebarResizeStart,
    handleSidebarResizeKeyDown,
  } = useSidebarLayout()

  const clearSelection = useNavigationSelectionStore((state) => state.clearSelection)
  const setDeepLinkFocusGuardValue = useCallback((value) => {
    deepLinkFocusGuardRef.current = value
    setDeepLinkFocusGuard(value)
  }, [])
  const setTouchNavigationGuardValue = useCallback((value) => {
    touchNavigationGuardRef.current = value
    setTouchNavigationGuard(value)
  }, [])

  // Visited-history → "back to previous" on delete. Each resolver returns where
  // to land after deleting the open item: the most-recent surviving sibling,
  // else the adjacent one, else the first remaining (else null).
  const { recordVisit: recordNavVisit, getRecentExisting } = useNavigationHistory()
  const getPostDeletePageTarget = useCallback(
    (remainingItems, deletedId, deletedIndex) =>
      pickPostDeleteTarget({
        history: { getRecentExisting },
        kind: 'pages',
        remainingItems,
        deletedId,
        deletedIndex,
      }),
    [getRecentExisting],
  )
  const getPostDeleteSectionTarget = useCallback(
    (remainingItems, deletedId, deletedIndex) =>
      pickPostDeleteTarget({
        history: { getRecentExisting },
        kind: 'sections',
        remainingItems,
        deletedId,
        deletedIndex,
      }),
    [getRecentExisting],
  )
  const getPostDeleteNotebookTarget = useCallback(
    (remainingItems, deletedId, deletedIndex) =>
      pickPostDeleteTarget({
        history: { getRecentExisting },
        kind: 'notebooks',
        remainingItems,
        deletedId,
        deletedIndex,
      }),
    [getRecentExisting],
  )
  // Set when the user explicitly clicks a section, so the auto-open-first-page
  // effect knows to act once that section's pages have loaded.
  const autoOpenSectionRef = useRef(null)
  const [autoOpenNonce, setAutoOpenNonce] = useState(0)

  const { session, loading, message: authMessage, setMessage: setAuthMessage, signIn, signOut, userId } = useAuth()

  const hydrateContentWithSignedUrls = useContentHydration(session)

  // Custom spell-check dictionary (desktop only; no-ops on touch devices).
  const { addWord: addCustomWord } = useCustomDictionary(userId)

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
    notebooksLoading,
    activeNotebookId,
    activeNotebook,
    isRecipesNotebook,
    message: notebookMessage,
    setMessage: setNotebookMessage,
    createNotebook,
    renameNotebook,
    deleteNotebook,
    reorderNotebooks,
  } = useNotebooks(userId, getPostDeleteNotebookTarget)

  // Keep the boot splash up until BOTH auth and the initial notebooks fetch
  // resolve. Gating on auth alone tore the splash down before notebooks loaded,
  // briefly flashing the empty-account WelcomeScreen for returning users.
  const bootLoading = loading || (Boolean(session) && notebooksLoading)

  const {
    sections,
    sectionsLoading,
    activeSectionId,
    message: sectionMessage,
    setMessage: setSectionMessage,
    createSection,
    renameSection,
    deleteSection,
    moveSection,
    copySection,
    reorderSections,
  } = useSections(userId, getPostDeleteSectionTarget)

  const {
    pages,
    sectionPageCache,
    loadSectionPagesMeta,
    activePageId,
    activePage,
    sectionDailySourcePage,
    loadPageContentById,
    titleDraft,
    saveStatus,
    hasPendingSaves,
    dataLoading,
    dailySourceSaving,
    message: pageMessage,
    setMessage: setPageMessage,
    scheduleSave,
    handleTitleChange,
    createPage,
    createPageWithContent,
    reorderSectionPages,
    setDailySourcePage,
    deletePage,
    draftConflict,
    resolveConflictWithServer,
    resolveConflictWithDraft,
    flushAllPendingSaves,
    flushSaveForPage,
    handleResume,
  } = usePages(userId, getPostDeletePageTarget)

  const { session: editorSession, sessionKey, bumpSessionNonce } = useEditorSession({
    activePageId,
    activePage,
    dataLoading,
    settingsMode,
    settingsContentVersion,
    templateContentRef,
    hydrateContentWithSignedUrls,
  })

  // Broadcast a single message string to every feature hook's message channel.
  // Defined here (before useNavigation) and memoized so nav can surface notices
  // without re-attaching its hashchange listener every render.
  const setMessage = useCallback(
    (msg) => {
      setAuthMessage(msg)
      setNotebookMessage(msg)
      setSectionMessage(msg)
      setPageMessage(msg)
      setSettingsMessage(msg)
    },
    [setAuthMessage, setNotebookMessage, setSectionMessage, setPageMessage, setSettingsMessage],
  )

  const {
    pendingTarget,
    selectNavigationTarget,
    handleInternalHashNavigate,
    clearBlockAnchorIfPresent,
  } = useNavigation({
    session,
    notebooks,
    notebooksLoading,
    sections,
    sectionPageCache,
    sectionsLoading,
    loadSectionPagesMeta,
    editorReady: editorSession.status === 'ready',
    flushSaveForPage,
    setDeepLinkFocusGuard: setDeepLinkFocusGuardValue,
    setMessage,
  })

  const message = authMessage || notebookMessage || sectionMessage || pageMessage || settingsMessage
  const isSaving = hasPendingSaves || templateSaveStatus === 'Saving...'
  const { confirmLeaveWhileSaving } = useSaveLifecycle({ isSaving, flushAllPendingSaves })
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

  // Record visits so post-delete navigation can return to where you were.
  useEffect(() => {
    if (activeNotebookId) recordNavVisit('notebooks', activeNotebookId)
  }, [activeNotebookId, recordNavVisit])
  useEffect(() => {
    if (activeSectionId) recordNavVisit('sections', activeSectionId)
  }, [activeSectionId, recordNavVisit])
  useEffect(() => {
    if (activePageId) recordNavVisit('pages', activePageId)
  }, [activePageId, recordNavVisit])

  // Auto-open a section's first page when the user clicks the section. Waits for
  // the section's pages to load, then navigates to the first page — unless the
  // currently-open page is already in that section (don't yank them away) or the
  // section is empty (fall through to the contextual empty state).
  useEffect(() => {
    const sectionId = autoOpenSectionRef.current
    if (!sectionId) return
    if (sectionId !== activeSectionId) return
    const entry = getSectionPageEntry(sectionPageCache, sectionId)
    if (entry.status !== SECTION_PAGE_STATUS.LOADED) return
    autoOpenSectionRef.current = null
    const activeInSection = entry.pages.some((page) => page.id === activePageId)
    if (activeInSection) return
    const firstPage = entry.pages[0]
    if (!firstPage) return
    selectNavigationTarget({
      notebookId: activeNotebookId,
      sectionId,
      pageId: firstPage.id,
    })
  }, [
    autoOpenNonce,
    activeSectionId,
    activePageId,
    activeNotebookId,
    sectionPageCache,
    selectNavigationTarget,
  ])

  const handleCopyMoveConfirm = async () => {
    const { action, section, destId } = copyMoveModal
    if (!destId) return
    setCopyMoveModal({ open: false, action: null, section: null, destId: '' })
    if (action === 'move') {
      const target =
        section.id === activeSectionId
          ? {
              notebookId: destId,
              sectionId: section.id,
              pageId: activePageId,
            }
          : { notebookId: destId }
      const moved = await moveSection(section, destId)
      if (moved) {
        selectNavigationTarget(target)
      }
    } else {
      await copySection(section, destId, session)
    }
  }

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
      // Tapping a toolbar button must not clear the armed deep-link selection —
      // a real mouse selection survives toolbar clicks too, so this lets you apply
      // Bold, then Strike, then Highlight to the same landed line.
      const eventTarget = event.target
      if (eventTarget instanceof Element && eventTarget.closest('.toolbar')) {
        pointerGestureRef.current = null
        return
      }
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
      if (deepLinkFocusGuardRef.current || touchNavigationGuardRef.current) {
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
        if (touchNavigationGuardRef.current) {
          setTouchNavigationGuardValue(false)
        }
      }
      clearBlockAnchorIfPresent()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- suppressFocusRef is a stable ref deliberately omitted; including it is a no-op
    [clearBlockAnchorIfPresent, setTouchNavigationGuardValue],
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
  const uploadImageRef = useRef(null)

  const { editor, suppressFocusRef } = useEditorSetup({
    authSession: session,
    editorSession,
    sessionKey,
    scheduleSave,
    scheduleSettingsSave,
    pendingEditTapRef,
    touchNavigationGuardRef,
    touchNavigationGuard,
    setTouchNavigationGuard,
    onNavigateHash: handleInternalHashNavigate,
    uploadImageRef,
    deepLinkFocusGuard,
    deepLinkFocusGuardRef,
  })

  const finalUploadImageAndInsert = useImageUpload(session, editor, setMessage)

  useEffect(() => {
    uploadImageRef.current = finalUploadImageAndInsert
  }, [finalUploadImageAndInsert])

  // Drive the deep-link text selection from navigationHelpers' DOM-pure landing
  // path. On touch we skip focus so the keyboard stays quiet; on desktop we focus
  // so native Ctrl+C / shortcuts work immediately, like a real mouse selection.
  useEffect(() => {
    if (!editor) return undefined
    registerDeepLinkSelectionApplier((blockId) => {
      applyDeepLinkSelection(editor, blockId, { focus: !isTouchOnlyDevice() })
    })
    return () => registerDeepLinkSelectionApplier(null)
  }, [editor])

  const primeTouchNavigationGuard = useCallback(() => {
    if (!isTouchOnlyDevice()) return
    setTouchNavigationGuardValue(true)
    suppressFocusRef.current = true
    const view = getMountedEditorView(editor)
    if (!view) return
    window.getSelection()?.removeAllRanges()
    view.dom.blur()
    requestAnimationFrame(() => {
      const nextView = getMountedEditorView(editor)
      if (nextView) {
        window.getSelection()?.removeAllRanges()
        nextView.dom.blur()
      }
    })
  }, [editor, suppressFocusRef, setTouchNavigationGuardValue])

  useEffect(() => {
    if (settingsMode !== 'daily-template') return
    setTemplateSaveStatus('Saved')
  }, [settingsMode, setTemplateSaveStatus])

  // Tear down the boot splash (baked into index.html) once auth resolves. The
  // error boundary and an inline failsafe timeout also remove it, so this is
  // just the primary, happy-path removal.
  useEffect(() => {
    if ((missingEnv || !bootLoading) && typeof window !== 'undefined' && window.__removeAppSplash) {
      window.__removeAppSplash()
    }
  }, [missingEnv, bootLoading, session, notebooksLoading])

  // On returning to the foreground / regaining network: resubscribe realtime
  // and refetch the active page so a change made on another device shows up.
  useResumeRefresh(handleResume)

  const handleSignOut = async () => {
    if (!confirmLeaveWhileSaving()) return
    await signOut()
    clearNavHierarchyCache()
    setMessage('')
    clearSelection()
    setSettingsMode(null)
    setTouchNavigationGuardValue(false)
    setDeepLinkFocusGuardValue(false)
  }

  const handleNotebookSelect = (nextNotebookId) => {
    if (settingsMode) {
      setSettingsMode(null)
    }
    primeTouchNavigationGuard()
    selectNavigationTarget({ notebookId: nextNotebookId })
  }

  const handleSectionSelect = (target) => {
    if (settingsMode) {
      setSettingsMode(null)
    }
    primeTouchNavigationGuard()
    selectNavigationTarget(target)
    // Arm auto-open of this section's first page (resolved once its pages load).
    if (target?.sectionId) {
      autoOpenSectionRef.current = target.sectionId
      setAutoOpenNonce((n) => n + 1)
    }
    // Close the drawer on mobile so tapping a section lands on the opened page.
    if (isMobileViewport) {
      setMobileSidebarOpen(false)
    }
  }

  const handlePageSelect = (target) => {
    if (settingsMode) {
      setSettingsMode(null)
    }
    primeTouchNavigationGuard()
    selectNavigationTarget(target)
    if (isMobileViewport) {
      setMobileSidebarOpen(false)
    }
  }

  const handleCreatePage = () => {
    if (settingsMode) {
      setSettingsMode(null)
    }
    primeTouchNavigationGuard()
    if (isMobileViewport) {
      setMobileSidebarOpen(false)
    }
    createPage(session, activeSectionId)
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

  const isSettingsHub = settingsMode === 'hub'
  const isTemplateEditing = settingsMode === 'daily-template'
  const isSamePageBlockAnchor =
    Boolean(pendingTarget?.blockId) &&
    pendingTarget.notebookId === activeNotebookId &&
    pendingTarget.sectionId === activeSectionId &&
    pendingTarget.pageId === activePageId
  const navigationRequiresEditorTransition = Boolean(
    pendingTarget &&
      !isSamePageBlockAnchor &&
      (pendingTarget.notebookId !== activeNotebookId ||
        pendingTarget.sectionId !== activeSectionId ||
        pendingTarget.pageId !== activePageId),
  )
  // editorTransitioning is true only while content is actually loading — the
  // activeSectionPending gate is gone because the content cache + session status
  // already covers that wait accurately.
  const editorTransitioning =
    (pendingTarget && navigationRequiresEditorTransition && editorSession.status !== 'ready') ||
    editorSession.status === 'loading'
  const hasEditorTarget =
    Boolean(activePage) ||
    Boolean(activePageId) ||
    navigationRequiresEditorTransition ||
    dataLoading
  // A deep-link block jump owns scroll; scroll restoration must defer to it.
  const deepLinkActive = Boolean(pendingTarget?.blockId)
  // Contextual empty state: match the message to where the user actually is.
  const editorEmptyState = (() => {
    if (activeSectionId) {
      const entry = getSectionPageEntry(sectionPageCache, activeSectionId)
      if (entry.status === SECTION_PAGE_STATUS.LOADED && entry.pages.length === 0) {
        return { kind: 'section', onCreatePage: handleCreatePage }
      }
    }
    if (
      activeNotebookId &&
      sections.filter((s) => s.notebook_id === activeNotebookId).length === 0
    ) {
      return {
        kind: 'notebook',
        onCreateSection: () => createSection(session, activeNotebookId),
      }
    }
    return { kind: 'none' }
  })()
  const breadcrumbNotebookTitle = activeNotebook?.title
  const breadcrumbSectionTitle = settingsMode ? 'Settings' : activeSection?.title
  const breadcrumbPageTitle = isSettingsHub
    ? 'Settings'
    : isTemplateEditing
      ? 'Daily Template'
      : titleDraft || activePage?.title
  const mobileBreadcrumbTitle = isSettingsHub
    ? 'Settings'
    : isTemplateEditing
      ? 'Daily Template'
      : titleDraft || activePage?.title || activeSection?.title || activeNotebook?.title || 'Life Tracker'

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

  if (bootLoading) {
    // The branded splash baked into index.html is still covering the screen;
    // render nothing so there's one continuous loading state, not three. This
    // also waits on the initial notebooks fetch so returning users don't flash
    // the empty-account WelcomeScreen before their pages load.
    return null
  }

  if (!session) {
    return <AuthForm onSignIn={signIn} message={message} />
  }

  if (notebooks.length === 0) {
    return <WelcomeScreen session={session} onCreateNotebook={() => createNotebook(session)} onSignOut={handleSignOut} />
  }

  const interactionHandlers = {
    onPointerDownCapture: handleAppPointerDownCapture,
    onPointerUpCapture: handleAppPointerUpCapture,
    onPointerCancelCapture: handleAppPointerCancelCapture,
    onKeyDownCapture: handleAppKeyDownCapture,
  }
  const headerProps = {
    notebookTitle: breadcrumbNotebookTitle,
    sectionTitle: isTemplateEditing ? 'Settings' : settingsMode ? null : breadcrumbSectionTitle,
    pageTitle: breadcrumbPageTitle,
    mobileTitle: mobileBreadcrumbTitle,
    settingsActive: Boolean(settingsMode),
    sidebarOpen: isSidebarOpen,
    onToggleSidebar: handleToggleSidebar,
    onOpenSettings: openSettings,
    onSignOut: handleSignOut,
  }
  const layout = {
    workspaceClassName,
    workspaceStyle,
    isMobileViewport,
    isSidebarOpen,
    sidebarCollapsed,
    closeMobileSidebar: () => setMobileSidebarOpen(false),
    onSidebarResizeStart: handleSidebarResizeStart,
    onSidebarResizeKeyDown: handleSidebarResizeKeyDown,
  }
  const navigationTreeProps = {
    className: `${isSidebarOpen ? 'open' : ''} ${sidebarCollapsed ? 'collapsed' : ''}`,
    notebooks,
    sections,
    sectionPageCache,
    activeNotebookId,
    activeSectionId,
    activePageId,
    userId,
    loading: dataLoading,
    compactBadges,
    isRecipesNotebook,
    isMobileViewport,
    mobileSidebarOpen,
    session,
    onSelectNotebook: handleNotebookSelect,
    onSelectSection: handleSectionSelect,
    onSelectPage: handlePageSelect,
    onCreateNotebook: () => createNotebook(session),
    onCreateSection: () => createSection(session, activeNotebookId),
    onCreatePage: handleCreatePage,
    onReorderNotebooks: reorderNotebooks,
    onReorderSections: reorderSections,
    onReorderPages: reorderSectionPages,
    onOpenContextMenu: handleOpenTreeContextMenu,
    onLoadSectionPages: loadSectionPagesMeta,
    onCreateWithContent: (title, content) =>
      createPageWithContent(session, activeSectionId, title, content),
  }
  const settings = {
    isHub: isSettingsHub,
    isTemplateEditing,
    showPrimaryEditor: !settingsMode,
    hubProps: {
      onEditDailyTemplate: openDailyTemplate,
      onBackToPages: closeSettings,
      loading: settingsLoading,
    },
  }
  const templateEditorProps = {
    editor,
    editorLocked: editorSession.status !== 'ready',
    title: 'Daily Template',
    onTitleChange: () => {},
    onDelete: () => {},
    saveStatus: templateSaveStatus,
    onImageUpload: finalUploadImageAndInsert,
    hasEditorTarget: true,
    message,
    notebookId: activeNotebookId,
    sectionId: activeSectionId,
    pageId: activePageId,
    onNavigateHash: handleInternalHashNavigate,
    allPages: pages,
    userId,
    titleReadOnly: true,
    showDelete: false,
    headerActions: (
      <button type="button" className="ghost" onClick={() => backToSettingsHub()}>
        Back to Settings
      </button>
    ),
    showAiDaily: false,
    showAiInsert: false,
  }
  const primaryEditorProps = {
    editor,
    editorLocked: editorSession.status !== 'ready' || editorTransitioning,
    title: titleDraft,
    onTitleChange: (value) => handleTitleChange(value, editor),
    onDelete: deletePage,
    saveStatus,
    onImageUpload: finalUploadImageAndInsert,
    hasEditorTarget: hasEditorTarget,
    editorTransitioning,
    message,
    notebookId: activeNotebookId,
    sectionId: activeSectionId,
    pageId: activePageId,
    restorePageId: editorSession.pageId,
    onNavigateHash: handleInternalHashNavigate,
    allPages: pages,
    dailySourcePage: sectionDailySourcePage,
    loadPageContentById,
    onSetDailySourcePage: setDailySourcePage,
    dailySourceSaving,
    userId,
    deepLinkActive,
    emptyState: editorEmptyState,
    onAddCustomWord: addCustomWord,
  }
  const treeContextMenuProps = {
    menu: treeContextMenu,
    onRename: () => {
      closeTreeContextMenu()
      if (treeContextMenu.type === 'notebook') {
        renameNotebook(treeContextMenu.item)
      } else if (treeContextMenu.type === 'section') {
        renameSection(treeContextMenu.item)
      }
    },
    onDelete: () => {
      closeTreeContextMenu()
      if (treeContextMenu.type === 'notebook') {
        deleteNotebook(treeContextMenu.item)
      } else if (treeContextMenu.type === 'section') {
        deleteSection(treeContextMenu.item)
      } else if (treeContextMenu.type === 'page') {
        deletePage(treeContextMenu.item)
      }
    },
    onCopy: () => {
      closeTreeContextMenu()
      openCopyMoveModal('copy')
    },
    onMove: () => {
      closeTreeContextMenu()
      openCopyMoveModal('move')
    },
  }
  const copyMoveModalProps = {
    modal: copyMoveModal,
    notebooks,
    activeNotebookId,
    onDestChange: (destId) => setCopyMoveModal((previous) => ({ ...previous, destId })),
    onClose: closeCopyMoveModal,
    onConfirm: handleCopyMoveConfirm,
  }
  const conflictModalProps = {
    conflict: draftConflict,
    onUseServer: () => {
      resolveConflictWithServer()
      bumpSessionNonce()
    },
    onUseDraft: () => {
      resolveConflictWithDraft()
      bumpSessionNonce()
    },
  }

  return (
    <Workspace
      interactionHandlers={interactionHandlers}
      headerProps={headerProps}
      workspaceRef={workspaceRef}
      layout={layout}
      navigationTreeProps={navigationTreeProps}
      settings={settings}
      editorKey={sessionKey}
      templateEditorProps={templateEditorProps}
      primaryEditorProps={primaryEditorProps}
      treeContextMenuProps={treeContextMenuProps}
      copyMoveModalProps={copyMoveModalProps}
      conflictModalProps={conflictModalProps}
    />
  )
}

export default App
