import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { EMPTY_DOC } from '../utils/constants'
import { sanitizeContentForSave } from '../utils/contentHelpers'
import { readPageDraft, writePageDraft, clearPageDraft } from '../utils/localDrafts'

export const useTrackers = (userId, activeSectionId, pendingNavRef, savedSelectionRef) => {
  const [trackers, setTrackers] = useState([])
  const [activeTrackerId, setActiveTrackerId] = useState(null)
  const [dataLoading, setDataLoading] = useState(false)
  const [trackerPageSaving, setTrackerPageSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const [saveStatus, setSaveStatus] = useState('Saved')
  const [hasPendingSaves, setHasPendingSaves] = useState(false)

  const titleDraftRef = useRef(titleDraft)
  const activeTrackerRef = useRef(null)
  const trackersRef = useRef(trackers)
  const pendingTitleByTrackerRef = useRef({})

  const saveTimersByTrackerRef = useRef({})
  const retryTimersByTrackerRef = useRef({})
  const inFlightByTrackerRef = useRef({})
  const queuedPayloadByTrackerRef = useRef({})

  const draftWriteTimersByTrackerRef = useRef({})
  const latestDraftKeyByTrackerRef = useRef({})

  const activeTrackerServer = trackers.find((tracker) => tracker.id === activeTrackerId) ?? null
  // Drafts are only needed when entering a page; we don't need to re-read localStorage every render.
  const activeDraft = useMemo(() => (activeTrackerId ? readPageDraft(activeTrackerId) : null), [activeTrackerId])
  const activeTracker = useMemo(() => {
    if (!activeTrackerServer) return null
    if (!activeDraft) return activeTrackerServer
    return {
      ...activeTrackerServer,
      title: typeof activeDraft.title === 'string' ? activeDraft.title : activeTrackerServer.title,
      content: activeDraft.content ?? activeTrackerServer.content,
    }
  }, [activeDraft, activeTrackerServer])

  useEffect(() => {
    titleDraftRef.current = titleDraft
  }, [titleDraft])

  useEffect(() => {
    activeTrackerRef.current = activeTracker
  }, [activeTracker])

  useEffect(() => {
    trackersRef.current = trackers
  }, [trackers])

  useEffect(() => {
    if (userId) return
    setTrackers([])
    setActiveTrackerId(null)
    setDataLoading(false)
    setTrackerPageSaving(false)
    setMessage('')
    setTitleDraft('')
    setSaveStatus('Saved')
    setHasPendingSaves(false)
    pendingTitleByTrackerRef.current = {}
    saveTimersByTrackerRef.current = {}
    retryTimersByTrackerRef.current = {}
    inFlightByTrackerRef.current = {}
    queuedPayloadByTrackerRef.current = {}
    draftWriteTimersByTrackerRef.current = {}
    latestDraftKeyByTrackerRef.current = {}
  }, [userId])

  useEffect(() => {
    return () => {
      const timers = saveTimersByTrackerRef.current
      Object.values(timers).forEach((timerId) => {
        if (timerId) clearTimeout(timerId)
      })
      const retryTimers = retryTimersByTrackerRef.current
      Object.values(retryTimers).forEach((timerId) => {
        if (timerId) clearTimeout(timerId)
      })
      const draftTimers = draftWriteTimersByTrackerRef.current
      Object.values(draftTimers).forEach((timerId) => {
        if (timerId) clearTimeout(timerId)
      })
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
      const { error } = await supabase.from('pages').update(payload).eq('id', trackerId)

      inFlightByTrackerRef.current[trackerId] = false

      if (error) {
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
        setMessage(error.message)
        if (trackerId === activeTrackerRef.current?.id) {
          setSaveStatus('Error')
        }
        recomputeHasPendingSaves()
        return
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

      if (trackerId === activeTrackerRef.current?.id) {
        setSaveStatus('Saved')
      }

      // If this was the latest draft we know about for this page and nothing else is pending,
      // clear local draft storage.
      maybeClearLocalDraft(trackerId, payloadKey)

      if (queuedPayloadByTrackerRef.current[trackerId]) {
        setTimeout(() => flushSaveForTrackerImpl(trackerId), 0)
      }

      recomputeHasPendingSaves()
    },
    [maybeClearLocalDraft, recomputeHasPendingSaves],
  )

  const loadTrackers = useCallback(
    async (sectionId) => {
      if (!userId || !sectionId) return
      setDataLoading(true)
      setMessage('')
      const { data, error } = await supabase
        .from('pages')
        .select('id, title, content, created_at, updated_at, section_id, sort_order, is_tracker_page')
        .eq('section_id', sectionId)
        .order('sort_order', { ascending: true, nullsLast: true })
        .order('updated_at', { ascending: false })

      if (error) {
        setMessage(error.message)
        setDataLoading(false)
        return
      }

      setTrackers(data ?? [])
      const pending = pendingNavRef?.current
      const saved = savedSelectionRef?.current
      if (pending?.pageId && data?.some((item) => item.id === pending.pageId)) {
        setActiveTrackerId(pending.pageId)
      } else {
        setActiveTrackerId((prev) => {
          if (prev && data?.some((item) => item.id === prev)) return prev
          if (saved?.pageId && data?.some((item) => item.id === saved.pageId)) {
            return saved.pageId
          }
          return data?.[0]?.id ?? null
        })
      }
      setDataLoading(false)
    },
    [userId, pendingNavRef, savedSelectionRef],
  )

  useEffect(() => {
    if (!activeSectionId) {
      setTrackers([])
      setActiveTrackerId(null)
      return
    }
    setTrackers([])
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

    setTrackers((prev) => [...prev, { ...data, sort_order: nextSortOrder }])
    setActiveTrackerId(data.id)
  }

  const reorderTrackers = useCallback(
    async (nextTrackers) => {
      if (!userId) return
      const reordered = nextTrackers.map((item, index) => ({
        ...item,
        sort_order: index + 1,
      }))
      setTrackers(reordered)
      const updates = reordered.map((item) =>
        supabase.from('pages').update({ sort_order: item.sort_order }).eq('id', item.id),
      )
      const results = await Promise.all(updates)
      const error = results.find((result) => result.error)?.error
      if (error) {
        setMessage(error.message)
      }
    },
    [userId],
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

      const { error: clearError } = await supabase
        .from('pages')
        .update({ is_tracker_page: false })
        .eq('section_id', activeSectionId)
        .eq('user_id', userId)
        .eq('is_tracker_page', true)

      if (clearError) {
        setTrackers(currentTrackers)
        setMessage(clearError.message)
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
    [userId, activeSectionId, loadTrackers],
  )

  const deleteTracker = async () => {
    const tracker = activeTrackerRef.current
    if (!tracker) return
    const confirmDelete = window.confirm(`Delete "${tracker.title}"? This cannot be undone.`)
    if (!confirmDelete) return

    const { error } = await supabase.from('pages').delete().eq('id', tracker.id)

    if (error) {
      setMessage(error.message)
      return
    }

    const nextTrackers = trackers.filter((item) => item.id !== tracker.id)
    setTrackers(nextTrackers)
    delete pendingTitleByTrackerRef.current[tracker.id]
    clearPageDraft(tracker.id)
    setActiveTrackerId((prev) => (prev === tracker.id ? nextTrackers[0]?.id ?? null : prev))
  }

  const sectionTrackerPage = trackers.find((item) => item.is_tracker_page) ?? null

  return {
    trackers,
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
    reorderTrackers,
    setTrackerPage,
    deleteTracker,
    activeTrackerRef,
    sectionTrackerPage,
  }
}
