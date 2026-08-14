import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { sanitizeContentForSave } from '../../utils/contentHelpers'
import { deleteImagesFromStorage, findRemovedImagePaths } from '../../utils/imageCleanup'
import { clearPageDraft } from '../../utils/localDrafts'
import { createSaveQueueController } from './saveQueueController'

const persistPage = (pageId, payload, knownTs) =>
  supabase
    .from('pages')
    .update(payload)
    .eq('id', pageId)
    .eq('updated_at', knownTs)
    .select('updated_at')
    .maybeSingle()

const fetchServerPage = async (pageId) => {
  const { data } = await supabase
    .from('pages')
    .select('content, updated_at, title')
    .eq('id', pageId)
    .maybeSingle()
  return data ?? null
}

export function useSaveQueue({
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
}) {
  const [saveStatus, setSaveStatus] = useState('Saved')
  const [hasPendingSaves, setHasPendingSaves] = useState(false)
  const pendingTitlesRef = useRef({})

  const handleSaved = useCallback(
    ({ pageId, payload, outcome }) => {
      const oldContent = pageContentCacheRef.current[pageId]?.content ?? null
      if (pendingTitlesRef.current[pageId] === payload.title) {
        delete pendingTitlesRef.current[pageId]
      }
      setPages((previous) =>
        previous.map((item) => (item.id === pageId ? { ...item, ...payload } : item)),
      )

      // Write through so the editor sees its own save without another fetch.
      if (payload.content !== undefined) {
        setPageContent(pageId, payload.content, outcome.nextKnownTs)
      }
      if (typeof payload.title === 'string') {
        const sectionId = pagesRef.current.find((item) => item.id === pageId)?.section_id
        updateCachedPage(sectionId, pageId, { title: payload.title })
      }

      // Storage cleanup is best-effort; a failed delete only leaves an orphan
      // for the existing manual cleanup script.
      const removedPaths = findRemovedImagePaths(oldContent, payload.content)
      if (removedPaths.length > 0) {
        void deleteImagesFromStorage(removedPaths)
      }
    },
    [pageContentCacheRef, setPageContent, setPages, pagesRef, updateCachedPage],
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
        onStatusChange: (pageId, status) => {
          if (pageId === activePageRef.current?.id) setSaveStatus(status)
        },
        onConflict: setDraftConflict,
        onError: setMessage,
        onSaved: handleSaved,
        onDraftCleared: (pageId) => {
          if (pageId === activePageRef.current?.id) {
            setDraftInvalidation((value) => value + 1)
          }
        },
      }),
    [
      activePageRef,
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

  const clearPendingTitle = useCallback((pageId) => {
    delete pendingTitlesRef.current[pageId]
  }, [])

  const scheduleSave = useCallback(
    (nextContent, nextTitle, pageIdOverride = null) => {
      const pageId = pageIdOverride ?? activePageRef.current?.id
      if (!pageId) return
      // Atomic navigation can resolve the active page from the metadata cache
      // before the section's full page list has finished loading. The editor is
      // already safe to use at that point, so let its resolved active page back
      // the save instead of silently dropping an early edit.
      const page =
        pagesRef.current.find((item) => item.id === pageId) ??
        (activePageRef.current?.id === pageId ? activePageRef.current : null)
      if (!page) return

      if (typeof nextTitle === 'string') {
        pendingTitlesRef.current[pageId] = nextTitle
      }

      const pendingTitle = pendingTitlesRef.current[pageId]
      const fallbackTitle =
        pendingTitle ??
        (pageId === activePageRef.current?.id ? titleDraftRef.current : page.title)
      const title = (nextTitle ?? fallbackTitle)?.trim() || 'Untitled Tracker'
      const payload = {
        title,
        content: sanitizeContentForSave(nextContent),
        updated_at: new Date().toISOString(),
      }
      const payloadKey = JSON.stringify({ title: payload.title, content: payload.content })

      controller.schedule({
        pageId,
        payload,
        payloadKey,
      })
    },
    [activePageRef, controller, titleDraftRef, pagesRef],
  )

  const handleTitleChange = useCallback(
    (value, editor) => {
      setTitleDraft(value)
      titleDraftRef.current = value
      if (!editor || !activePageRef.current) return
      scheduleSave(editor.getJSON(), value)
    },
    [activePageRef, scheduleSave, setTitleDraft, titleDraftRef],
  )

  const resolveConflictWithServer = useCallback(() => {
    if (!draftConflict) return
    clearPageDraft(draftConflict.pageId)
    // Save-time conflicts still have the pre-remote-write cache snapshot.
    if (draftConflict.serverContent !== undefined) {
      setPageContent(
        draftConflict.pageId,
        draftConflict.serverContent,
        draftConflict.serverUpdatedAt,
      )
    }
    if (typeof draftConflict.serverTitle === 'string') {
      setPages((previous) =>
        previous.map((item) =>
          item.id === draftConflict.pageId
            ? {
                ...item,
                title: draftConflict.serverTitle,
                updated_at: draftConflict.serverUpdatedAt,
              }
            : item,
        ),
      )
    }
    controller.discardConflict(draftConflict.pageId)
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
    setPages,
  ])

  const resolveConflictWithDraft = useCallback(() => {
    if (!draftConflict) return
    const { pageId, draftContent, draftTitle } = draftConflict
    setDraftConflict(null)
    scheduleSave(draftContent, draftTitle, pageId)
  }, [draftConflict, scheduleSave, setDraftConflict])

  return {
    saveStatus,
    setSaveStatus,
    hasPendingSaves,
    scheduleSave,
    handleTitleChange,
    getHasPendingForPage: controller.hasPendingForPage,
    hasLocalChanges: controller.hasLocalChanges,
    flushAllPendingSaves: controller.flushAll,
    flushSaveForPage: controller.flush,
    clearPendingTitle,
    resolveConflictWithServer,
    resolveConflictWithDraft,
  }
}
