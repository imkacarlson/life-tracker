import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { EMPTY_DOC } from '../utils/constants'
import { sanitizeContentForSave } from '../utils/contentHelpers'
import { deleteImagesFromStorage, findRemovedImagePaths, collectAllImagePaths } from '../utils/imageCleanup'
import { readPageDraft, writePageDraft, clearPageDraft } from '../utils/localDrafts'
import { detectConflict } from '../utils/draftHelpers'
import { classifySaveResult } from '../utils/saveConflict'
import { clearNavHierarchyCache } from '../utils/resolveNavHierarchy'
import { runSupabaseQueryWithRetry } from '../utils/supabaseRetry'
import { useSectionPageCache } from './useSectionPageCache'
import { usePageContentCache, PAGE_CONTENT_STATUS } from './usePageContentCache'
import { usePageRealtime } from './sync/usePageRealtime'

export const useTrackers = (userId, activeSectionId) => {
  const [trackers, setTrackers] = useState([])
  const [loadedTrackerSectionId, setLoadedTrackerSectionId] = useState(null)
  const [activeTrackerId, setActiveTrackerId] = useState(null)
  const [dataLoading, setDataLoading] = useState(false)
  const [trackerPageSaving, setTrackerPageSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const [saveStatus, setSaveStatus] = useState('Saved')
  const [hasPendingSaves, setHasPendingSaves] = useState(false)
  const [draftConflict, setDraftConflict] = useState(null)
  const [draftInvalidation, setDraftInvalidation] = useState(0)
  const [activeDraft, setActiveDraft] = useState(null)

  const titleDraftRef = useRef(titleDraft)
  const activeTrackerRef = useRef(null)
  const draftConflictRef = useRef(null)
  const trackersRef = useRef(trackers)
  const pendingTitleByTrackerRef = useRef({})

  const saveTimersByTrackerRef = useRef({})
  const retryTimersByTrackerRef = useRef({})
  const inFlightByTrackerRef = useRef({})
  const queuedPayloadByTrackerRef = useRef({})
  const loadRequestIdRef = useRef(0)

  const draftWriteTimersByTrackerRef = useRef({})
  const latestDraftKeyByTrackerRef = useRef({})
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
    invalidatePage,
    getKnownUpdatedAt,
    setKnownUpdatedAt,
  } = usePageContentCache(userId)
  const pageContentCacheRef = useRef(pageContentCache)

  useEffect(() => {
    pageContentCacheRef.current = pageContentCache
  }, [pageContentCache])

  // Realtime: when another device writes the active page, react accordingly.
  const handleRemotePageChange = useCallback(
    (payload) => {
      const row = payload?.new
      if (!row?.id) return
      const trackerId = row.id
      const incomingTs = row.updated_at
      // Ignore echoes of our own write (we already advanced the token to this value).
      if (incomingTs && getKnownUpdatedAt(trackerId) === incomingTs) return

      const isDirty =
        !!queuedPayloadByTrackerRef.current[trackerId] ||
        !!inFlightByTrackerRef.current[trackerId] ||
        !!latestDraftKeyByTrackerRef.current[trackerId]

      if (isDirty) {
        // Bump the token only — the next save attempt will enter the conflict
        // gate (its UPDATE will mismatch and route through detectConflict).
        if (incomingTs) setKnownUpdatedAt(trackerId, incomingTs)
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
    [getKnownUpdatedAt, setKnownUpdatedAt, setPageContent],
  )
  usePageRealtime(activeTrackerId, handleRemotePageChange)

  const activeTrackerServer = trackers.find((tracker) => tracker.id === activeTrackerId) ?? null
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
    setTrackers([])
    setLoadedTrackerSectionId(null)
    setActiveTrackerId(null)
    setDataLoading(false)
    setTrackerPageSaving(false)
    setMessage('')
    setTitleDraft('')
    setSaveStatus('Saved')
    setHasPendingSaves(false)
    setActiveDraft(null)
    pendingTitleByTrackerRef.current = {}
    saveTimersByTrackerRef.current = {}
    retryTimersByTrackerRef.current = {}
    inFlightByTrackerRef.current = {}
    queuedPayloadByTrackerRef.current = {}
    draftWriteTimersByTrackerRef.current = {}
    latestDraftKeyByTrackerRef.current = {}
  }, [userId])

  // Immediately write any debounced localStorage drafts for all trackers.
  const flushAllPendingDrafts = useCallback(() => {
    const draftTimers = draftWriteTimersByTrackerRef.current
    const queued = queuedPayloadByTrackerRef.current
    for (const trackerId of Object.keys(draftTimers)) {
      const timerId = draftTimers[trackerId]
      if (!timerId) continue
      clearTimeout(timerId)
      draftTimers[trackerId] = null
      // Write the draft from the queued payload (the source of truth for pending content).
      const pending = queued[trackerId]
      if (pending) {
        writePageDraft(trackerId, {
          title: pending.payload.title,
          content: pending.payload.content,
          ts: Date.now(),
        })
      }
    }
  }, [])

  const recomputeHasPendingSaves = useCallback(() => {
    const timers = saveTimersByTrackerRef.current
    const retries = retryTimersByTrackerRef.current
    const inflight = inFlightByTrackerRef.current
    const queued = queuedPayloadByTrackerRef.current
    const hasPending =
      Object.values(timers).some(Boolean) ||
      Object.values(retries).some(Boolean) ||
      Object.values(inflight).some(Boolean) ||
      Object.values(queued).some(Boolean)
    setHasPendingSaves((prev) => (prev === hasPending ? prev : hasPending))
    return hasPending
  }, [])

  const getHasPendingForTracker = useCallback((trackerId) => {
    if (!trackerId) return false
    const timer = saveTimersByTrackerRef.current[trackerId]
    const retry = retryTimersByTrackerRef.current[trackerId]
    const inflight = inFlightByTrackerRef.current[trackerId]
    const queued = queuedPayloadByTrackerRef.current[trackerId]
    return Boolean(timer || retry || inflight || queued)
  }, [])

  const scheduleLocalDraftWrite = useCallback((trackerId, draft, draftKey) => {
    if (!trackerId) return
    latestDraftKeyByTrackerRef.current[trackerId] = draftKey
    const existingTimer = draftWriteTimersByTrackerRef.current[trackerId]
    if (existingTimer) clearTimeout(existingTimer)
    draftWriteTimersByTrackerRef.current[trackerId] = setTimeout(() => {
      writePageDraft(trackerId, draft)
      draftWriteTimersByTrackerRef.current[trackerId] = null
    }, 250)
  }, [])

  const maybeClearLocalDraft = useCallback((trackerId, payloadKey) => {
    if (!trackerId || !payloadKey) return
    if (getHasPendingForTracker(trackerId)) return
    const latestKey = latestDraftKeyByTrackerRef.current[trackerId]
    if (!latestKey || latestKey !== payloadKey) return
    const existingTimer = draftWriteTimersByTrackerRef.current[trackerId]
    if (existingTimer) {
      clearTimeout(existingTimer)
      draftWriteTimersByTrackerRef.current[trackerId] = null
    }
    clearPageDraft(trackerId)
    delete latestDraftKeyByTrackerRef.current[trackerId]
    // Only invalidate if the cleared draft belongs to the active page to avoid unnecessary re-reads.
    if (trackerId === activeTrackerRef.current?.id) {
      setDraftInvalidation((n) => n + 1)
    }
  }, [getHasPendingForTracker])

  const flushSaveForTracker = useCallback(
    async function flushSaveForTrackerImpl(trackerId) {
      if (!trackerId) return
      if (inFlightByTrackerRef.current[trackerId]) return

      const queued = queuedPayloadByTrackerRef.current[trackerId]
      if (!queued) {
        recomputeHasPendingSaves()
        return
      }

      const timer = saveTimersByTrackerRef.current[trackerId]
      if (timer) {
        clearTimeout(timer)
        saveTimersByTrackerRef.current[trackerId] = null
      }

      queuedPayloadByTrackerRef.current[trackerId] = null
      inFlightByTrackerRef.current[trackerId] = true
      recomputeHasPendingSaves()

      const { payload, payloadKey } = queued
      // Snapshot the old content before the save so we can diff for removed images.
      const oldContent = pageContentCacheRef.current[trackerId]?.content ?? null
      // Optimistic concurrency: only write if the server still has the version we last read.
      // Zero rows matched -> conflict (someone else wrote since we loaded).
      // If we never observed a version (e.g. title-only save on a page that was never
      // opened), fetch it just-in-time so we have a baseline to compare against.
      let knownTs = getKnownUpdatedAt(trackerId)
      if (!knownTs) {
        const { data: seedRow } = await supabase
          .from('pages')
          .select('updated_at')
          .eq('id', trackerId)
          .maybeSingle()
        if (seedRow?.updated_at) {
          setKnownUpdatedAt(trackerId, seedRow.updated_at)
          knownTs = seedRow.updated_at
        }
      }
      const { data, error } = await supabase
        .from('pages')
        .update(payload)
        .eq('id', trackerId)
        .eq('updated_at', knownTs)
        .select('updated_at')
        .maybeSingle()

      inFlightByTrackerRef.current[trackerId] = false

      const outcome = classifySaveResult({ data, error, knownTs })

      if (outcome.kind === 'conflict') {
        // Someone else wrote since we loaded. Fetch the server row, run the
        // existing detectConflict gate, and surface the modal if content actually
        // differs. Identical content (e.g. a retry whose first attempt succeeded)
        // auto-recovers by adopting the server's new version token.
        const { data: serverRow } = await supabase
          .from('pages')
          .select('content, updated_at, title')
          .eq('id', trackerId)
          .maybeSingle()
        const conflictDescriptor = serverRow
          ? detectConflict(trackerId, serverRow, {
              ts: Date.parse(payload.updated_at) || Date.now(),
              content: payload.content,
              title: payload.title,
            })
          : null
        if (conflictDescriptor) {
          // Real conflict — drop the in-flight payload (the user will pick a side
          // via ConflictModal). Stop the retry timer; this is not a network error.
          const rt = retryTimersByTrackerRef.current[trackerId]
          if (rt) { clearTimeout(rt); retryTimersByTrackerRef.current[trackerId] = null }
          if (serverRow?.updated_at) setKnownUpdatedAt(trackerId, serverRow.updated_at)
          if (trackerId === activeTrackerRef.current?.id) {
            setSaveStatus('Conflict')
          }
          setDraftConflict(conflictDescriptor)
          recomputeHasPendingSaves()
          return
        }
        // Identical content — silently adopt the new server version and treat as success.
        if (serverRow?.updated_at) setKnownUpdatedAt(trackerId, serverRow.updated_at)
        // fall through to success cleanup below
      } else if (outcome.kind === 'error') {
        // If nothing newer is queued, keep this payload as the next attempt.
        if (!queuedPayloadByTrackerRef.current[trackerId]) {
          queuedPayloadByTrackerRef.current[trackerId] = queued
        }
        if (!retryTimersByTrackerRef.current[trackerId]) {
          retryTimersByTrackerRef.current[trackerId] = setTimeout(() => {
            retryTimersByTrackerRef.current[trackerId] = null
            flushSaveForTrackerImpl(trackerId)
            recomputeHasPendingSaves()
          }, 5000)
        }
        const errMsg = outcome.error?.message ?? 'Save failed'
        setMessage(errMsg)
        if (trackerId === activeTrackerRef.current?.id) {
          setSaveStatus('Error')
        }
        recomputeHasPendingSaves()
        return
      } else if (outcome.kind === 'ok' && outcome.nextKnownTs) {
        setKnownUpdatedAt(trackerId, outcome.nextKnownTs)
      }

      const retryTimer = retryTimersByTrackerRef.current[trackerId]
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimersByTrackerRef.current[trackerId] = null
      }

      if (pendingTitleByTrackerRef.current[trackerId] === payload.title) {
        delete pendingTitleByTrackerRef.current[trackerId]
      }

      setTrackers((prev) =>
        prev.map((item) => (item.id === trackerId ? { ...item, ...payload } : item)),
      )
      // Write-through to the content cache so the editor sees its own saves without re-fetching.
      // Pass the latest server timestamp (when available) so the OCC token stays current.
      if (payload.content !== undefined) {
        setPageContent(trackerId, payload.content, outcome.nextKnownTs)
      }
      if (typeof payload.title === 'string') {
        const sectionId = trackersRef.current.find((t) => t.id === trackerId)?.section_id
        updateCachedPage(sectionId, trackerId, { title: payload.title })
      }

      if (trackerId === activeTrackerRef.current?.id) {
        setSaveStatus('Saved')
      }

      // Clean up images that were removed since the last saved version.
      // Fire-and-forget — a failed cleanup just leaves an orphan for the manual script.
      const removedPaths = findRemovedImagePaths(oldContent, payload.content)
      if (removedPaths.length > 0) {
        deleteImagesFromStorage(removedPaths)
      }

      // If this was the latest draft we know about for this page and nothing else is pending,
      // clear local draft storage.
      maybeClearLocalDraft(trackerId, payloadKey)

      if (queuedPayloadByTrackerRef.current[trackerId]) {
        setTimeout(() => flushSaveForTrackerImpl(trackerId), 0)
      }

      recomputeHasPendingSaves()
    },
    [maybeClearLocalDraft, recomputeHasPendingSaves, setPageContent, updateCachedPage, getKnownUpdatedAt, setKnownUpdatedAt],
  )

  // Flush all pending saves (both localStorage drafts and Supabase writes) immediately.
  // Called on visibilitychange/pagehide/beforeunload to prevent data loss.
  const flushAllPendingSaves = useCallback(() => {
    // 1. Flush localStorage drafts first (synchronous, survives page kill).
    flushAllPendingDrafts()

    // 2. Trigger Supabase saves for all trackers with pending debounce timers.
    const timers = saveTimersByTrackerRef.current
    for (const trackerId of Object.keys(timers)) {
      const timerId = timers[trackerId]
      if (!timerId) continue
      clearTimeout(timerId)
      timers[trackerId] = null
      flushSaveForTracker(trackerId)
    }
    recomputeHasPendingSaves()
  }, [flushAllPendingDrafts, flushSaveForTracker, recomputeHasPendingSaves])

  useEffect(() => {
    return () => {
      // Flush pending saves before clearing timers on unmount.
      flushAllPendingSaves()

      const retryTimers = retryTimersByTrackerRef.current
      Object.values(retryTimers).forEach((timerId) => {
        if (timerId) clearTimeout(timerId)
      })
    }
  }, [flushAllPendingSaves])

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
      setTrackers(nextTrackers)
      setLoadedTrackerSectionId(sectionId)
      seedSectionPages(sectionId, nextTrackers)
      setActiveTrackerId((prev) => {
        if (prev && nextTrackers.some((item) => item.id === prev)) return prev
        return nextTrackers[0]?.id ?? null
      })
      setDataLoading(false)
    },
    [seedSectionPages, userId],
  )

  useEffect(() => {
    if (!activeSectionId) {
      loadRequestIdRef.current += 1
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
  }, [activeDraft, activeTrackerId, activeTracker, getHasPendingForTracker])

  const scheduleSave = useCallback(
    (nextContent, nextTitle, trackerIdOverride = null) => {
      const trackerId = trackerIdOverride ?? activeTrackerRef.current?.id
      if (!trackerId) return
      const tracker = trackersRef.current.find((item) => item.id === trackerId)
      if (!tracker) return

      if (typeof nextTitle === 'string') {
        pendingTitleByTrackerRef.current[trackerId] = nextTitle
      }

      const pendingTitle = pendingTitleByTrackerRef.current[trackerId]
      const fallbackTitle =
        pendingTitle ??
        (trackerId === activeTrackerRef.current?.id ? titleDraftRef.current : tracker.title)
      const title = (nextTitle ?? fallbackTitle)?.trim() || 'Untitled Tracker'
      const payload = {
        title,
        content: sanitizeContentForSave(nextContent),
        updated_at: new Date().toISOString(),
      }
      const payloadKey = JSON.stringify({ title: payload.title, content: payload.content })

      scheduleLocalDraftWrite(
        trackerId,
        { title: payload.title, content: payload.content, ts: Date.now() },
        payloadKey,
      )

      queuedPayloadByTrackerRef.current[trackerId] = { payload, payloadKey }

      const existingTimer = saveTimersByTrackerRef.current[trackerId]
      if (existingTimer) {
        clearTimeout(existingTimer)
      }
      const retryTimer = retryTimersByTrackerRef.current[trackerId]
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimersByTrackerRef.current[trackerId] = null
      }

      if (trackerId === activeTrackerRef.current?.id) {
        setSaveStatus('Saving...')
      }

      saveTimersByTrackerRef.current[trackerId] = setTimeout(() => {
        saveTimersByTrackerRef.current[trackerId] = null
        flushSaveForTracker(trackerId)
        recomputeHasPendingSaves()
      }, 2000)

      recomputeHasPendingSaves()
    },
    [flushSaveForTracker, recomputeHasPendingSaves, scheduleLocalDraftWrite],
  )

  const handleTitleChange = (value, editor) => {
    setTitleDraft(value)
    titleDraftRef.current = value
    if (!editor || !activeTrackerRef.current) return
    scheduleSave(editor.getJSON(), value)
  }

  const createTracker = async (session, sectionId) => {
    if (!session || !sectionId) return
    setMessage('')
    const title = 'Untitled'
    const existingOrders = trackers
      .map((item) => item.sort_order)
      .filter((value) => typeof value === 'number')
    const nextSortOrder = existingOrders.length > 0 ? Math.max(...existingOrders) + 1 : 1

    const { data, error } = await supabase
      .from('pages')
      .insert({
        title,
        user_id: session.user.id,
        content: EMPTY_DOC,
        section_id: sectionId,
        sort_order: nextSortOrder,
      })
      .select()
      .single()

    if (error) {
      setMessage(error.message)
      return
    }

    const created = { ...data, sort_order: nextSortOrder }
    setTrackers((prev) => [...prev, created])
    upsertCachedPage(sectionId, created)
    // Seed the content cache so the editor can mount immediately without a round-trip.
    setPageContent(data.id, EMPTY_DOC)
    setActiveTrackerId(data.id)
  }

  // Create a page with specific title and content (used by Paste Recipe).
  const createTrackerWithContent = async (session, sectionId, pageTitle, content) => {
    if (!session || !sectionId) return null
    setMessage('')
    const existingOrders = trackers
      .map((item) => item.sort_order)
      .filter((value) => typeof value === 'number')
    const nextSortOrder = existingOrders.length > 0 ? Math.max(...existingOrders) + 1 : 1

    const { data, error } = await supabase
      .from('pages')
      .insert({
        title: pageTitle,
        user_id: session.user.id,
        content,
        section_id: sectionId,
        sort_order: nextSortOrder,
      })
      .select()
      .single()

    if (error) {
      setMessage(error.message)
      return null
    }

    const created = { ...data, sort_order: nextSortOrder }
    setTrackers((prev) => [...prev, created])
    upsertCachedPage(sectionId, created)
    // Seed the content cache so the editor can mount immediately without a round-trip.
    setPageContent(data.id, content)
    setActiveTrackerId(data.id)
    return data
  }

  const reorderTrackers = useCallback(
    async (nextTrackers) => {
      if (!userId) return
      const reordered = nextTrackers.map((item, index) => ({
        ...item,
        sort_order: index + 1,
      }))
      setTrackers(reordered)
      seedSectionPages(activeSectionId, reordered)
      const updates = reordered.map((item) =>
        supabase.from('pages').update({ sort_order: item.sort_order }).eq('id', item.id),
      )
      const results = await Promise.all(updates)
      const error = results.find((result) => result.error)?.error
      if (error) {
        setMessage(error.message)
      }
    },
    [activeSectionId, seedSectionPages, userId],
  )

  const setTrackerPage = useCallback(
    async (pageId) => {
      if (!userId || !activeSectionId || !pageId) return
      const currentTrackers = trackersRef.current
      const target = currentTrackers.find((item) => item.id === pageId)
      if (!target || target.is_tracker_page) return

      setMessage('')
      setTrackerPageSaving(true)
      setTrackers((prev) =>
        prev.map((item) => ({
          ...item,
          is_tracker_page: item.id === pageId,
        })),
      )
      markCachedTrackerPage(activeSectionId, pageId)

      const { error: clearError } = await supabase
        .from('pages')
        .update({ is_tracker_page: false })
        .eq('section_id', activeSectionId)
        .eq('user_id', userId)
        .eq('is_tracker_page', true)

      if (clearError) {
        setTrackers(currentTrackers)
        setMessage(clearError.message)
        seedSectionPages(activeSectionId, currentTrackers)
        setTrackerPageSaving(false)
        return
      }

      const { error: setError } = await supabase
        .from('pages')
        .update({
          is_tracker_page: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', pageId)
        .eq('section_id', activeSectionId)
        .eq('user_id', userId)

      if (setError) {
        setTrackers(currentTrackers)
        setMessage(setError.message)
        await loadTrackers(activeSectionId)
        setTrackerPageSaving(false)
        return
      }

      setTrackerPageSaving(false)
    },
    [userId, activeSectionId, loadTrackers, markCachedTrackerPage, seedSectionPages],
  )

  const deleteTracker = async (trackerToDelete = null) => {
    const tracker =
      trackerToDelete != null &&
      typeof trackerToDelete === 'object' &&
      typeof trackerToDelete.id === 'string' &&
      typeof trackerToDelete.title === 'string' &&
      !('nativeEvent' in trackerToDelete)
        ? trackerToDelete
        : activeTrackerRef.current
    if (!tracker) return
    const confirmDelete = window.confirm(`Delete "${tracker.title}"? This cannot be undone.`)
    if (!confirmDelete) return

    // Collect image paths before deletion (pull content from cache, not tracker metadata).
    const trackerContent = pageContentCacheRef.current[tracker.id]?.content ?? null
    const imagePaths = collectAllImagePaths([{ ...tracker, content: trackerContent }])

    const { error } = await supabase.from('pages').delete().eq('id', tracker.id)

    if (error) {
      setMessage(error.message)
      return
    }

    // Clean up images from storage after successful DB delete (fire-and-forget).
    if (imagePaths.length > 0) {
      deleteImagesFromStorage(imagePaths)
    }

    clearNavHierarchyCache()
    const nextTrackers = trackers.filter((item) => item.id !== tracker.id)
    setTrackers(nextTrackers)
    removeCachedPage(tracker.section_id ?? activeSectionId, tracker.id)
    delete pendingTitleByTrackerRef.current[tracker.id]
    clearPageDraft(tracker.id)
    setActiveTrackerId((prev) => (prev === tracker.id ? nextTrackers[0]?.id ?? null : prev))
  }

  const resolveConflictWithServer = useCallback(() => {
    if (!draftConflict) return
    clearPageDraft(draftConflict.trackerId)
    // For save-time conflicts the cache still holds the stale pre-remote-write
    // snapshot, so refresh it from the descriptor we built when classifying.
    if (draftConflict.serverContent !== undefined) {
      setPageContent(draftConflict.trackerId, draftConflict.serverContent, draftConflict.serverUpdatedAt)
    }
    if (typeof draftConflict.serverTitle === 'string') {
      setTrackers((prev) =>
        prev.map((item) =>
          item.id === draftConflict.trackerId
            ? { ...item, title: draftConflict.serverTitle, updated_at: draftConflict.serverUpdatedAt }
            : item,
        ),
      )
    }
    // Drop any queued/in-flight save; the user chose to discard their edit.
    queuedPayloadByTrackerRef.current[draftConflict.trackerId] = null
    const rt = retryTimersByTrackerRef.current[draftConflict.trackerId]
    if (rt) { clearTimeout(rt); retryTimersByTrackerRef.current[draftConflict.trackerId] = null }
    setActiveDraft(null)
    setDraftConflict(null)
    setDraftInvalidation((n) => n + 1)
    setSaveStatus('Saved')
  }, [draftConflict, setPageContent])

  const resolveConflictWithDraft = useCallback(() => {
    if (!draftConflict) return
    const { trackerId, draftContent, draftTitle } = draftConflict
    setDraftConflict(null)
    // Push the draft content to the server via the normal save pipeline.
    scheduleSave(draftContent, draftTitle, trackerId)
  }, [draftConflict, scheduleSave])

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
    reorderTrackers,
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
  }
}
