import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { readPageDraft, clearPageDraft } from '../utils/localDrafts'
import { detectConflict } from '../utils/draftHelpers'
import { runSupabaseQueryWithRetry } from '../utils/supabaseRetry'
import { getSectionPages } from '../utils/sectionPages'
import { toClientPage } from '../utils/pageModel'
import { useSectionPageCache } from './useSectionPageCache'
import { usePageContentCache, PAGE_CONTENT_STATUS } from './usePageContentCache'
import { usePageRealtime } from './sync/usePageRealtime'
import { usePageCrud } from './pages/usePageCrud'
import { useSaveQueue } from './pages/useSaveQueue'
import { useNavigationSelectionStore } from '../stores/navigationSelectionStore'

export const usePages = (userId, getPostDeleteTarget = null) => {
  const [pages, setPages] = useState([])
  const [loadedPagesSectionId, setLoadedPagesSectionId] = useState(null)
  const activeSectionId = useNavigationSelectionStore((state) => state.activeSectionId)
  const activePageId = useNavigationSelectionStore((state) => state.activePageId)
  const selectSection = useNavigationSelectionStore((state) => state.selectSection)
  const selectPage = useNavigationSelectionStore((state) => state.selectPage)
  const [dataLoading, setDataLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const [draftConflict, setDraftConflict] = useState(null)
  const [draftInvalidation, setDraftInvalidation] = useState(0)
  const [activeDraft, setActiveDraft] = useState(null)
  // Bumped on resume to force the realtime channel to tear down + resubscribe.
  const [reconnectKey, setReconnectKey] = useState(0)

  const titleDraftRef = useRef(titleDraft)
  const activePageRef = useRef(null)
  const draftConflictRef = useRef(null)
  const pagesRef = useRef(pages)
  const loadRequestIdRef = useRef(0)
  const {
    sectionPageCache,
    loadSectionPagesMeta,
    seedSectionPages,
    upsertCachedPage,
    updateCachedPage,
    removeCachedPage,
    markCachedDailySourcePage,
  } = useSectionPageCache(userId)

  const {
    pageContentCache,
    loadPageContent,
    setPageContent,
    getKnownUpdatedAt,
    setKnownUpdatedAt,
  } = usePageContentCache(userId)
  const pageContentCacheRef = useRef(pageContentCache)

  useEffect(() => {
    pageContentCacheRef.current = pageContentCache
  }, [pageContentCache])

  const {
    saveStatus,
    setSaveStatus,
    hasPendingSaves,
    scheduleSave,
    handleTitleChange,
    getHasPendingForPage,
    hasLocalChanges,
    flushAllPendingSaves,
    flushSaveForPage,
    clearPendingTitle,
    resolveConflictWithServer,
    resolveConflictWithDraft,
  } = useSaveQueue({
    userId,
    pagesRef,
    activePageRef,
    titleDraftRef,
    pageContentCacheRef,
    setPages,
    setPageContent,
    updateCachedPage,
    getKnownUpdatedAt,
    setKnownUpdatedAt,
    setMessage,
    draftConflict,
    setDraftConflict,
    setActiveDraft,
    setDraftInvalidation,
    setTitleDraft,
  })

  // Realtime: when another device writes the active page, react accordingly.
  const handleRemotePageChange = useCallback(
    (payload) => {
      const row = payload?.new
      if (!row?.id) return
      const pageId = row.id
      const incomingTs = row.updated_at
      // Ignore echoes of our own write (we already advanced the token to this value).
      if (incomingTs && getKnownUpdatedAt(pageId) === incomingTs) return

      const isDirty = hasLocalChanges(pageId)

      if (isDirty) {
        // Keep the old version token. The pending save must compare against the
        // version we loaded before editing so a remote write becomes an OCC conflict
        // instead of becoming the new baseline for a stale local overwrite.
        return
      }

      // Clean editor: swap server content in and advance the token in one step.
      if (row.content !== undefined) {
        setPageContent(pageId, row.content, incomingTs)
      } else if (incomingTs) {
        setKnownUpdatedAt(pageId, incomingTs)
      }
      if (typeof row.title === 'string') {
        setPages((prev) =>
          prev.map((item) => (item.id === pageId ? { ...item, title: row.title, updated_at: incomingTs } : item)),
        )
      }
    },
    [getKnownUpdatedAt, hasLocalChanges, setKnownUpdatedAt, setPageContent],
  )
  usePageRealtime(activePageId, handleRemotePageChange, reconnectKey)

  // Keep the active page id in a ref so the stable resume handler can read it
  // without being recreated on every page switch.
  const activePageIdRef = useRef(activePageId)
  useEffect(() => {
    activePageIdRef.current = activePageId
  }, [activePageId])

  // Called when the app returns to the foreground (see useResumeRefresh). The
  // realtime socket may have died while backgrounded, so resubscribe; then pull
  // the latest server content for the active page through the same
  // conflict-aware path as realtime — catching edits made on another device
  // without clobbering unsaved local changes (handleRemotePageChange bails when
  // the editor is dirty).
  const handleResume = useCallback(async () => {
    setReconnectKey((key) => key + 1)
    const pageId = activePageIdRef.current
    if (!pageId) return
    const { data, error } = await runSupabaseQueryWithRetry(() =>
      supabase.from('pages').select('id, content, updated_at, title').eq('id', pageId).single(),
    )
    if (error || !data) return
    handleRemotePageChange({ new: data })
  }, [handleRemotePageChange])

  const cachedActiveSectionPages = useMemo(
    () => getSectionPages(sectionPageCache, activeSectionId),
    [sectionPageCache, activeSectionId],
  )
  const activePageServer = useMemo(() => {
    const pageFromLoadedSection = pages.find((page) => page.id === activePageId) ?? null
    if (pageFromLoadedSection) return pageFromLoadedSection
    return cachedActiveSectionPages.find((page) => page.id === activePageId) ?? null
  }, [activePageId, cachedActiveSectionPages, pages])
  const activePage = useMemo(() => {
    if (!activePageServer) return null
    const contentEntry = pageContentCache[activePageId]
    const contentLoaded = contentEntry?.status === PAGE_CONTENT_STATUS.LOADED
    // undefined signals "content not yet fetched from cache" — keeps the editor
    // in loading state until the single-row content fetch completes.
    const serverContent = contentLoaded ? (contentEntry.content ?? null) : undefined

    // While a conflict is pending, show server content (modal blocks interaction).
    if (draftConflict?.pageId === activePageId) {
      return { ...activePageServer, content: serverContent }
    }
    if (!activeDraft) {
      return { ...activePageServer, content: serverContent }
    }
    return {
      ...activePageServer,
      title: typeof activeDraft.title === 'string' ? activeDraft.title : activePageServer.title,
      content: contentLoaded ? (activeDraft.content ?? serverContent) : undefined,
    }
  }, [activeDraft, activePageServer, draftConflict, activePageId, pageContentCache])

  useEffect(() => {
    titleDraftRef.current = titleDraft
  }, [titleDraft])

  useEffect(() => {
    activePageRef.current = activePage
  }, [activePage])

  useEffect(() => {
    draftConflictRef.current = draftConflict
  }, [draftConflict])

  // Trigger a single-row content fetch when the active page changes and content
  // isn't already cached (Notesnook openSession pattern).
  useEffect(() => {
    if (!activePageId) return
    const entry = pageContentCacheRef.current[activePageId]
    if (entry?.status === PAGE_CONTENT_STATUS.LOADED || entry?.status === PAGE_CONTENT_STATUS.LOADING) return
    loadPageContent(activePageId)
  }, [activePageId, loadPageContent])

  // Read the draft and detect conflicts in a single effect so both values are
  // always computed from the same draft snapshot.  Two separate effects caused a
  // one-render flash of the conflict modal: the draft-read effect would call
  // setActiveDraft(null) which only took effect next render, while the conflict
  // effect ran with the stale activeDraft and briefly set a conflict.
  useEffect(() => {
    if (!activePageId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- page changes synchronize the local-draft snapshot
      setActiveDraft(null)
      setDraftConflict(null)
      return
    }
    const draft = readPageDraft(activePageId)
    // Conflict detection requires the server content — only run once the cache has loaded.
    const contentEntry = pageContentCacheRef.current[activePageId]
    const serverContentLoaded = contentEntry?.status === PAGE_CONTENT_STATUS.LOADED
    const serverRowForConflict = serverContentLoaded
      ? { ...activePageServer, content: contentEntry.content ?? null }
      : null
    const conflict = detectConflict(activePageId, serverRowForConflict, draft)
    // Do not classify or clear a draft until both content and the OCC version
    // have arrived. The content request can beat the section metadata request
    // on slower clients; treating that partial row as conflict-free can erase
    // a real conflict before updated_at is available.
    const serverVersionLoaded = Boolean(serverRowForConflict?.updated_at)
    if (draft && !conflict && serverVersionLoaded) {
      clearPageDraft(activePageId)
      setActiveDraft(null)
    } else {
      setActiveDraft(draft)
    }
    setDraftConflict(conflict)
  }, [activePageId, activePageServer, pageContentCache, draftInvalidation])

  useEffect(() => {
    pagesRef.current = pages
  }, [pages])

  useEffect(() => {
    if (userId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset user-scoped state on sign-out
    setPages([])
    setLoadedPagesSectionId(null)
    setDataLoading(false)
    setMessage('')
    setTitleDraft('')
    setActiveDraft(null)
  }, [userId])

  const loadPages = useCallback(
    async (sectionId) => {
      if (!userId || !sectionId) return
      const requestId = ++loadRequestIdRef.current
      setDataLoading(true)
      setMessage('')
      const { data, error } = await runSupabaseQueryWithRetry(() =>
        supabase
          .from('pages')
          .select('id, title, created_at, updated_at, section_id, sort_order, is_tracker_page')
          .eq('section_id', sectionId)
          .order('sort_order', { ascending: true, nullsLast: true })
          .order('updated_at', { ascending: false }),
      )

      if (loadRequestIdRef.current !== requestId) return

      if (error) {
        setMessage(error.message)
        setDataLoading(false)
        return
      }

      const nextPages = (data ?? []).map(toClientPage)
      nextPages.forEach((page) => {
        if (page?.id && page?.updated_at) setKnownUpdatedAt(page.id, page.updated_at)
      })
      setPages(nextPages)
      setLoadedPagesSectionId(sectionId)
      seedSectionPages(sectionId, nextPages)
      const selection = useNavigationSelectionStore.getState()
      if (
        selection.activeSectionId === sectionId &&
        !nextPages.some((item) => item.id === selection.activePageId)
      ) {
        const firstPageId = nextPages[0]?.id ?? null
        if (firstPageId) {
          selectPage(selection.activeNotebookId, sectionId, firstPageId)
        } else {
          selectSection(selection.activeNotebookId, sectionId)
        }
      }
      setDataLoading(false)
    },
    [seedSectionPages, selectSection, selectPage, setKnownUpdatedAt, userId],
  )

  useEffect(() => {
    if (!activeSectionId) {
      loadRequestIdRef.current += 1
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the section snapshot when there is no active section
      setPages([])
      setLoadedPagesSectionId(null)
      setDataLoading(false)
      return
    }
    setPages([])
    setLoadedPagesSectionId(null)
    loadPages(activeSectionId)
  }, [activeSectionId, loadPages])

  useEffect(() => {
    if (activePage) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronize the editable title when the selected page changes
      setTitleDraft(activePage.title)
    } else {
      setTitleDraft('')
    }
    if (!activePageId) {
      setSaveStatus('Saved')
      return
    }
    if (getHasPendingForPage(activePageId)) {
      setSaveStatus('Saving...')
      return
    }
    if (activeDraft) {
      setSaveStatus('Unsaved (local)')
      return
    }
    setSaveStatus('Saved')
  }, [activeDraft, activePageId, activePage, getHasPendingForPage, setSaveStatus])

  const {
    dailySourceSaving,
    createPage,
    createPageWithContent,
    reorderSectionPages,
    setDailySourcePage,
    deletePage,
  } = usePageCrud({
    userId,
    pages,
    pagesRef,
    activePageRef,
    pageContentCacheRef,
    setPages,
    setMessage,
    setPageContent,
    seedSectionPages,
    upsertCachedPage,
    removeCachedPage,
    markCachedDailySourcePage,
    loadPages,
    getPostDeleteTarget,
    clearPendingTitle,
  })

  const sectionDailySourcePage = pages.find((item) => item.isDailySource) ?? null

  const loadPageContentById = useCallback(
    async (pageId) => {
      if (!pageId) return null
      const entry = pageContentCacheRef.current[pageId]
      if (entry?.status === PAGE_CONTENT_STATUS.LOADED) {
        return entry.content ?? null
      }
      return loadPageContent(pageId)
    },
    [loadPageContent],
  )

  return {
    pages,
    sectionPageCache,
    loadSectionPagesMeta,
    loadedPagesSectionId,
    activePageId,
    activePage,
    titleDraft,
    setTitleDraft,
    saveStatus,
    setSaveStatus,
    hasPendingSaves,
    dataLoading,
    dailySourceSaving,
    message,
    setMessage,
    scheduleSave,
    handleTitleChange,
    createPage,
    createPageWithContent,
    reorderSectionPages,
    setDailySourcePage,
    deletePage,
    activePageRef,
    draftConflictRef,
    sectionDailySourcePage,
    loadPageContentById,
    draftConflict,
    resolveConflictWithServer,
    resolveConflictWithDraft,
    flushAllPendingSaves,
    flushSaveForPage,
    handleResume,
  }
}
