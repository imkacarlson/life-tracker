import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { EMPTY_DOC } from '../../utils/constants'
import { collectAllImagePaths, deleteImagesFromStorage } from '../../utils/imageCleanup'
import { clearPageDraft } from '../../utils/localDrafts'
import { clearNavHierarchyCache } from '../../utils/resolveNavHierarchy'
import { insertPageAfter, reindexSortOrder } from '../../utils/sidebarReorder'

/**
 * Owns page mutations for a section. Autosave intentionally lives in a
 * separate hook because CRUD actions and the editor's write queue have
 * different lifecycles and failure handling.
 */
export function usePageCrud({
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
}) {
  const [trackerPageSaving, setTrackerPageSaving] = useState(false)

  useEffect(() => {
    if (userId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset mutation status on sign-out
    setTrackerPageSaving(false)
  }, [userId])

  // Reordering can target any expanded section, not only the active one.
  const reorderSectionPages = useCallback(
    async (sectionId, nextPages) => {
      if (!userId || !sectionId || !Array.isArray(nextPages)) return
      const reordered = reindexSortOrder(nextPages)
      seedSectionPages(sectionId, reordered)
      if (sectionId === activeSectionId) {
        setTrackers(reordered)
      }

      const updates = reordered.map((item) =>
        supabase.from('pages').update({ sort_order: item.sort_order }).eq('id', item.id),
      )
      const results = await Promise.all(updates)
      const error = results.find((result) => result.error)?.error
      if (error) {
        setMessage(error.message)
        return
      }

      seedSectionPages(sectionId, reordered)
      if (sectionId === activeSectionId) {
        setTrackers(reordered)
      }
    },
    [activeSectionId, seedSectionPages, setMessage, setTrackers, userId],
  )

  const createTracker = async (session, sectionId) => {
    if (!session || !sectionId) return
    setMessage('')
    const title = 'Untitled'
    // This value is provisional; reorderSectionPages reindexes 1..n below.
    const existingOrders = trackers
      .map((item) => item.sort_order)
      .filter((value) => typeof value === 'number')
    const provisionalSortOrder = existingOrders.length > 0 ? Math.max(...existingOrders) + 1 : 1

    const { data, error } = await supabase
      .from('pages')
      .insert({
        title,
        user_id: session.user.id,
        content: EMPTY_DOC,
        section_id: sectionId,
        sort_order: provisionalSortOrder,
      })
      .select()
      .single()

    if (error) {
      setMessage(error.message)
      return
    }

    const created = { ...data, sort_order: provisionalSortOrder }
    // New pages appear immediately after the selected page, then use the same
    // persisted reorder path as drag-and-drop.
    const desiredOrder = insertPageAfter(trackers, created, activeTrackerId)
    await reorderSectionPages(sectionId, desiredOrder)
    setPageContent(data.id, EMPTY_DOC, data.updated_at)
    setActiveTrackerId(data.id)
  }

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
    setTrackers((previous) => [...previous, created])
    upsertCachedPage(sectionId, created)
    setPageContent(data.id, content, data.updated_at)
    setActiveTrackerId(data.id)
    return data
  }

  const setTrackerPage = useCallback(
    async (pageId) => {
      if (!userId || !activeSectionId || !pageId) return
      const currentTrackers = trackersRef.current
      const target = currentTrackers.find((item) => item.id === pageId)
      if (!target || target.is_tracker_page) return

      setMessage('')
      setTrackerPageSaving(true)
      setTrackers((previous) =>
        previous.map((item) => ({
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
    [
      activeSectionId,
      loadTrackers,
      markCachedTrackerPage,
      seedSectionPages,
      setMessage,
      setTrackers,
      trackersRef,
      userId,
    ],
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

    const trackerContent = pageContentCacheRef.current[tracker.id]?.content ?? null
    const imagePaths = collectAllImagePaths([{ ...tracker, content: trackerContent }])
    const { error } = await supabase.from('pages').delete().eq('id', tracker.id)

    if (error) {
      setMessage(error.message)
      return
    }

    if (imagePaths.length > 0) {
      void deleteImagesFromStorage(imagePaths)
    }

    clearNavHierarchyCache()
    const deletedIndex = trackers.findIndex((item) => item.id === tracker.id)
    const nextTrackers = trackers.filter((item) => item.id !== tracker.id)
    setTrackers(nextTrackers)
    removeCachedPage(tracker.section_id ?? activeSectionId, tracker.id)
    clearPendingTitle(tracker.id)
    clearPageDraft(tracker.id)
    setActiveTrackerId((previous) =>
      previous === tracker.id
        ? getPostDeleteTarget?.(nextTrackers, tracker.id, deletedIndex) ??
          nextTrackers[0]?.id ??
          null
        : previous,
    )
  }

  return {
    trackerPageSaving,
    createTracker,
    createTrackerWithContent,
    reorderSectionPages,
    setTrackerPage,
    deleteTracker,
  }
}
