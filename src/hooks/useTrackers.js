import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { readPageDraft, clearPageDraft } from '../utils/localDrafts'
import { detectConflict } from '../utils/draftHelpers'
import { runSupabaseQueryWithRetry } from '../utils/supabaseRetry'
import { getSectionPages } from '../utils/sectionPages'
import { useSectionPageCache } from './useSectionPageCache'
import { usePageContentCache, PAGE_CONTENT_STATUS } from './usePageContentCache'
import { usePageRealtime } from './sync/usePageRealtime'
import { usePageCrud } from './trackers/usePageCrud'
import { useSaveQueue } from './trackers/useSaveQueue'

export const useTrackers = (userId, activeSectionId, getPostDeleteTarget = null) => {
  const [trackers, setTrackers] = useState([])
  const [loadedTrackerSectionId, setLoadedTrackerSectionId] = useState(null)
  const [activeTrackerId, setActiveTrackerId] = useState(null)
  const [dataLoading, setDataLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const [draftConflict, setDraftConflict] = useState(null)
  const [draftInvalidation, setDraftInvalidation] = useState(0)
  const [activeDraft, setActiveDraft] = useState(null)
  // Bumped on resume to force the realtime channel to tear down + resubscribe.
  const [reconnectKey, setReconnectKey] = useState(0)

  const titleDraftRef = useRef(titleDraft)
  const activeTrackerRef = useRef(null)
  const draftConflictRef = useRef(null)
  const trackersRef = useRef(trackers)
  const loadRequestIdRef = useRef(0)
  const {
    sectionPageCache,
    loadSectionPagesMeta,
    seedSectionPages,
    upsertCachedPage,
    updateCachedPage,
    removeCachedPage,
    markCachedTrackerPage,
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
    getHasPendingForTracker,
    hasLocalChanges,
    flushAllPendingSaves,
    flushSaveForTracker,
    clearPendingTitle,
    resolveConflictWithServer,
    resolveConflictWithDraft,
  } = useSaveQueue({
    userId,
    trackersRef,
    activeTrackerRef,
    titleDraftRef,
    pageContentCacheRef,
    setTrackers,
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
      const trackerId = row.id
      const incomingTs = row.updated_at
      // Ignore echoes of our own write (we already advanced the token to this value).
      if (incomingTs && getKnownUpdatedAt(trackerId) === incomingTs) return

      const isDirty = hasLocalChanges(trackerId)

      if (isDirty) {
        // Keep the old version token. The pending save must compare against the
        // version we loaded before editing so a remote write becomes an OCC conflict
        // instead of becoming the new baseline for a stale local overwrite.
        return
      }

      // Clean editor: swap server content in and advance the token in one step.
      if (row.content !== undefined) {
        setPageContent(trackerId, row.content, incomingTs)
      } else if (incomingTs) {
        setKnownUpdatedAt(trackerId, incomingTs)
      }
      if (typeof row.title === 'string') {
        setTrackers((prev) =>
          prev.map((item) => (item.id === trackerId ? { ...item, title: row.title, updated_at: incomingTs } : item)),
        )
      }
    },
    [getKnownUpdatedAt, hasLocalChanges, setKnownUpdatedAt, setPageContent],
  )
  usePageRealtime(activeTrackerId, handleRemotePageChange, reconnectKey)

  // Keep the active page id in a ref so the stable resume handler can read it
  // without being recreated on every page switch.
  const activeTrackerIdRef = useRef(activeTrackerId)
  useEffect(() => {
    activeTrackerIdRef.current = activeTrackerId
  }, [activeTrackerId])

  // Called when the app returns to the foreground (see useResumeRefresh). The
  // realtime socket may have died while backgrounded, so resubscribe; then pull
  // the latest server content for the active page through the same
  // conflict-aware path as realtime — catching edits made on another device
  // without clobbering unsaved local changes (handleRemotePageChange bails when
  // the editor is dirty).
  const handleResume = useCallback(async () => {
    setReconnectKey((key) => key + 1)
    const pageId = activeTrackerIdRef.current
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
  const activeTrackerServer = useMemo(() => {
    const trackerFromLoadedSection = trackers.find((tracker) => tracker.id === activeTrackerId) ?? null
    if (trackerFromLoadedSection) return trackerFromLoadedSection
    return cachedActiveSectionPages.find((tracker) => tracker.id === activeTrackerId) ?? null
  }, [activeTrackerId, cachedActiveSectionPages, trackers])
  const activeTracker = useMemo(() => {
    if (!activeTrackerServer) return null
    const contentEntry = pageContentCache[activeTrackerId]
    const contentLoaded = contentEntry?.status === PAGE_CONTENT_STATUS.LOADED
    // undefined signals "content not yet fetched from cache" — keeps the editor
    // in loading state until the single-row content fetch completes.
    const serverContent = contentLoaded ? (contentEntry.content ?? null) : undefined

    // While a conflict is pending, show server content (modal blocks interaction).
    if (draftConflict?.trackerId === activeTrackerId) {
      return { ...activeTrackerServer, content: serverContent }
    }
    if (!activeDraft) {
      return { ...activeTrackerServer, content: serverContent }
    }
    return {
      ...activeTrackerServer,
      title: typeof activeDraft.title === 'string' ? activeDraft.title : activeTrackerServer.title,
      content: contentLoaded ? (activeDraft.content ?? serverContent) : undefined,
    }
  }, [activeDraft, activeTrackerServer, draftConflict, activeTrackerId, pageContentCache])

  useEffect(() => {
    titleDraftRef.current = titleDraft
  }, [titleDraft])

  useEffect(() => {
    activeTrackerRef.current = activeTracker
  }, [activeTracker])

  useEffect(() => {
    draftConflictRef.current = draftConflict
  }, [draftConflict])

  // Trigger a single-row content fetch when the active page changes and content
  // isn't already cached (Notesnook openSession pattern).
  useEffect(() => {
    if (!activeTrackerId) return
    const entry = pageContentCacheRef.current[activeTrackerId]
    if (entry?.status === PAGE_CONTENT_STATUS.LOADED || entry?.status === PAGE_CONTENT_STATUS.LOADING) return
    loadPageContent(activeTrackerId)
  }, [activeTrackerId, loadPageContent])

  // Read the draft and detect conflicts in a single effect so both values are
  // always computed from the same draft snapshot.  Two separate effects caused a
  // one-render flash of the conflict modal: the draft-read effect would call
  // setActiveDraft(null) which only took effect next render, while the conflict
  // effect ran with the stale activeDraft and briefly set a conflict.
  useEffect(() => {
    if (!activeTrackerId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- page changes synchronize the local-draft snapshot
      setActiveDraft(null)
      setDraftConflict(null)
      return
    }
    const draft = readPageDraft(activeTrackerId)
    // Conflict detection requires the server content — only run once the cache has loaded.
    const contentEntry = pageContentCacheRef.current[activeTrackerId]
    const serverContentLoaded = contentEntry?.status === PAGE_CONTENT_STATUS.LOADED
    const serverRowForConflict = serverContentLoaded
      ? { ...activeTrackerServer, content: contentEntry.content ?? null }
      : null
    const conflict = detectConflict(activeTrackerId, serverRowForConflict, draft)
    // If the draft exists but content matches the server (stale draft left over from a
    // previous session whose save succeeded), clear it silently so the status doesn't
    // stick on "Unsaved (local)" and localStorage doesn't leak orphan entries.
    if (draft && !conflict && serverRowForConflict) {
      clearPageDraft(activeTrackerId)
      setActiveDraft(null)
    } else {
      setActiveDraft(draft)
    }
    setDraftConflict(conflict)
  }, [activeTrackerId, activeTrackerServer, pageContentCache, draftInvalidation])

  useEffect(() => {
    trackersRef.current = trackers
  }, [trackers])

  useEffect(() => {
    if (userId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset user-scoped state on sign-out
    setTrackers([])
    setLoadedTrackerSectionId(null)
    setActiveTrackerId(null)
    setDataLoading(false)
    setMessage('')
    setTitleDraft('')
    setActiveDraft(null)
  }, [userId])

  const loadTrackers = useCallback(
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

      const nextTrackers = data ?? []
      nextTrackers.forEach((page) => {
        if (page?.id && page?.updated_at) setKnownUpdatedAt(page.id, page.updated_at)
      })
      setTrackers(nextTrackers)
      setLoadedTrackerSectionId(sectionId)
      seedSectionPages(sectionId, nextTrackers)
      setActiveTrackerId((prev) => {
        if (prev && nextTrackers.some((item) => item.id === prev)) return prev
        return nextTrackers[0]?.id ?? null
      })
      setDataLoading(false)
    },
    [seedSectionPages, setKnownUpdatedAt, userId],
  )

  useEffect(() => {
    if (!activeSectionId) {
      loadRequestIdRef.current += 1
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the section snapshot when there is no active section
      setTrackers([])
      setLoadedTrackerSectionId(null)
      setActiveTrackerId(null)
      setDataLoading(false)
      return
    }
    setTrackers([])
    setLoadedTrackerSectionId(null)
    setActiveTrackerId(null)
    loadTrackers(activeSectionId)
  }, [activeSectionId, loadTrackers])

  useEffect(() => {
    if (activeTracker) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronize the editable title when the selected page changes
      setTitleDraft(activeTracker.title)
    } else {
      setTitleDraft('')
    }
    if (!activeTrackerId) {
      setSaveStatus('Saved')
      return
    }
    if (getHasPendingForTracker(activeTrackerId)) {
      setSaveStatus('Saving...')
      return
    }
    if (activeDraft) {
      setSaveStatus('Unsaved (local)')
      return
    }
    setSaveStatus('Saved')
  }, [activeDraft, activeTrackerId, activeTracker, getHasPendingForTracker, setSaveStatus])

  const {
    trackerPageSaving,
    createTracker,
    createTrackerWithContent,
    reorderSectionPages,
    setTrackerPage,
    deleteTracker,
  } = usePageCrud({
    userId,
    activeSectionId,
    activeTrackerId,
    trackers,
    trackersRef,
    activeTrackerRef,
    pageContentCacheRef,
    setTrackers,
    setActiveTrackerId,
    setMessage,
    setPageContent,
    seedSectionPages,
    upsertCachedPage,
    removeCachedPage,
    markCachedTrackerPage,
    loadTrackers,
    getPostDeleteTarget,
    clearPendingTitle,
  })

  const sectionTrackerPage = trackers.find((item) => item.is_tracker_page) ?? null

  const loadTrackerContent = useCallback(
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
    trackers,
    sectionPageCache,
    loadSectionPagesMeta,
    loadedTrackerSectionId,
    activeTrackerId,
    setActiveTrackerId,
    activeTracker,
    titleDraft,
    setTitleDraft,
    saveStatus,
    setSaveStatus,
    hasPendingSaves,
    dataLoading,
    trackerPageSaving,
    message,
    setMessage,
    scheduleSave,
    handleTitleChange,
    createTracker,
    createTrackerWithContent,
    reorderSectionPages,
    setTrackerPage,
    deleteTracker,
    activeTrackerRef,
    draftConflictRef,
    sectionTrackerPage,
    loadTrackerContent,
    draftConflict,
    resolveConflictWithServer,
    resolveConflictWithDraft,
    flushAllPendingSaves,
    flushSaveForTracker,
    handleResume,
  }
}
