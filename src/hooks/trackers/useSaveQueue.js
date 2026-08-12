import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { sanitizeContentForSave } from '../../utils/contentHelpers'
import { deleteImagesFromStorage, findRemovedImagePaths } from '../../utils/imageCleanup'
import { clearPageDraft } from '../../utils/localDrafts'
import { createSaveQueueController } from './saveQueueController'

const persistPage = (trackerId, payload, knownTs) =>
  supabase
    .from('pages')
    .update(payload)
    .eq('id', trackerId)
    .eq('updated_at', knownTs)
    .select('updated_at')
    .maybeSingle()

const fetchServerPage = async (trackerId) => {
  const { data } = await supabase
    .from('pages')
    .select('content, updated_at, title')
    .eq('id', trackerId)
    .maybeSingle()
  return data ?? null
}

export function useSaveQueue({
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
}) {
  const [saveStatus, setSaveStatus] = useState('Saved')
  const [hasPendingSaves, setHasPendingSaves] = useState(false)
  const pendingTitlesRef = useRef({})

  const handleSaved = useCallback(
    ({ trackerId, payload, outcome }) => {
      const oldContent = pageContentCacheRef.current[trackerId]?.content ?? null
      if (pendingTitlesRef.current[trackerId] === payload.title) {
        delete pendingTitlesRef.current[trackerId]
      }
      setTrackers((previous) =>
        previous.map((item) => (item.id === trackerId ? { ...item, ...payload } : item)),
      )

      // Write through so the editor sees its own save without another fetch.
      if (payload.content !== undefined) {
        setPageContent(trackerId, payload.content, outcome.nextKnownTs)
      }
      if (typeof payload.title === 'string') {
        const sectionId = trackersRef.current.find((item) => item.id === trackerId)?.section_id
        updateCachedPage(sectionId, trackerId, { title: payload.title })
      }

      // Storage cleanup is best-effort; a failed delete only leaves an orphan
      // for the existing manual cleanup script.
      const removedPaths = findRemovedImagePaths(oldContent, payload.content)
      if (removedPaths.length > 0) {
        void deleteImagesFromStorage(removedPaths)
      }
    },
    [pageContentCacheRef, setPageContent, setTrackers, trackersRef, updateCachedPage],
  )

  const controller = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs -- the factory stores ref-backed getters; it does not read ref values during render
      createSaveQueueController({
        persistPage,
        fetchServerPage,
        getKnownUpdatedAt,
        setKnownUpdatedAt,
        onPendingChange: setHasPendingSaves,
        onStatusChange: (trackerId, status) => {
          if (trackerId === activeTrackerRef.current?.id) setSaveStatus(status)
        },
        onConflict: setDraftConflict,
        onError: setMessage,
        onSaved: handleSaved,
        onDraftCleared: (trackerId) => {
          if (trackerId === activeTrackerRef.current?.id) {
            setDraftInvalidation((value) => value + 1)
          }
        },
      }),
    [
      activeTrackerRef,
      getKnownUpdatedAt,
      handleSaved,
      setDraftConflict,
      setDraftInvalidation,
      setKnownUpdatedAt,
      setMessage,
    ],
  )

  useEffect(() => {
    if (userId) return
    pendingTitlesRef.current = {}
    controller.reset()
    setSaveStatus('Saved')
  }, [controller, userId])

  useEffect(() => () => controller.dispose(), [controller])

  const clearPendingTitle = useCallback((trackerId) => {
    delete pendingTitlesRef.current[trackerId]
  }, [])

  const scheduleSave = useCallback(
    (nextContent, nextTitle, trackerIdOverride = null) => {
      const trackerId = trackerIdOverride ?? activeTrackerRef.current?.id
      if (!trackerId) return
      const tracker = trackersRef.current.find((item) => item.id === trackerId)
      if (!tracker) return

      if (typeof nextTitle === 'string') {
        pendingTitlesRef.current[trackerId] = nextTitle
      }

      const pendingTitle = pendingTitlesRef.current[trackerId]
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

      controller.schedule({
        trackerId,
        payload,
        payloadKey,
      })
    },
    [activeTrackerRef, controller, titleDraftRef, trackersRef],
  )

  const handleTitleChange = useCallback(
    (value, editor) => {
      setTitleDraft(value)
      titleDraftRef.current = value
      if (!editor || !activeTrackerRef.current) return
      scheduleSave(editor.getJSON(), value)
    },
    [activeTrackerRef, scheduleSave, setTitleDraft, titleDraftRef],
  )

  const resolveConflictWithServer = useCallback(() => {
    if (!draftConflict) return
    clearPageDraft(draftConflict.trackerId)
    // Save-time conflicts still have the pre-remote-write cache snapshot.
    if (draftConflict.serverContent !== undefined) {
      setPageContent(
        draftConflict.trackerId,
        draftConflict.serverContent,
        draftConflict.serverUpdatedAt,
      )
    }
    if (typeof draftConflict.serverTitle === 'string') {
      setTrackers((previous) =>
        previous.map((item) =>
          item.id === draftConflict.trackerId
            ? {
                ...item,
                title: draftConflict.serverTitle,
                updated_at: draftConflict.serverUpdatedAt,
              }
            : item,
        ),
      )
    }
    controller.discardConflict(draftConflict.trackerId)
    setActiveDraft(null)
    setDraftConflict(null)
    setDraftInvalidation((value) => value + 1)
    setSaveStatus('Saved')
  }, [
    controller,
    draftConflict,
    setActiveDraft,
    setDraftConflict,
    setDraftInvalidation,
    setPageContent,
    setTrackers,
  ])

  const resolveConflictWithDraft = useCallback(() => {
    if (!draftConflict) return
    const { trackerId, draftContent, draftTitle } = draftConflict
    setDraftConflict(null)
    scheduleSave(draftContent, draftTitle, trackerId)
  }, [draftConflict, scheduleSave, setDraftConflict])

  return {
    saveStatus,
    setSaveStatus,
    hasPendingSaves,
    scheduleSave,
    handleTitleChange,
    getHasPendingForTracker: controller.hasPendingForTracker,
    hasLocalChanges: controller.hasLocalChanges,
    flushAllPendingSaves: controller.flushAll,
    flushSaveForTracker: controller.flush,
    clearPendingTitle,
    resolveConflictWithServer,
    resolveConflictWithDraft,
  }
}
