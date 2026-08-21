import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { EMPTY_DOC } from '../../utils/constants'
import { buildNewTopicDoc } from '../../utils/librarySuggestions'
import { collectAllImagePaths, deleteImagesFromStorage } from '../../utils/imageCleanup'
import { clearPageDraft } from '../../utils/localDrafts'
import { clearNavHierarchyCache } from '../../utils/resolveNavHierarchy'
import {
  insertPageAfter,
  mergeReorderedPages,
  reindexSortOrder,
} from '../../utils/sidebarReorder'
import { toClientPage } from '../../utils/pageModel'
import { useNavigationSelectionStore } from '../../stores/navigationSelectionStore'

const getNextSortOrder = (pages) => {
  const orders = pages
    .map((page) => page.sort_order)
    .filter((value) => typeof value === 'number')
  return orders.length > 0 ? Math.max(...orders) + 1 : 1
}

const insertPage = ({ session, sectionId, title, content, sortOrder, libraryRole = null }) =>
  supabase
    .from('pages')
    .insert({
      title,
      user_id: session.user.id,
      content,
      section_id: sectionId,
      sort_order: sortOrder,
      // Only ever 'topic' from the app. Every other Library role is scaffolding
      // the rebuild owns, and captures come from the bot.
      ...(libraryRole ? { library_role: libraryRole } : {}),
    })
    .select()
    .single()

export function usePageCrud({
  userId,
  pages,
  pagesRef,
  activePageRef,
  pageContentCacheRef,
  setPages,
  setMessage,
  setPageContent,
  seedSectionPages,
  mergeSectionPageOrder,
  upsertCachedPage,
  removeCachedPage,
  markCachedDailySourcePage,
  loadPages,
  getPostDeleteTarget,
  clearPendingTitle,
}) {
  const activeNotebookId = useNavigationSelectionStore((state) => state.activeNotebookId)
  const activeSectionId = useNavigationSelectionStore((state) => state.activeSectionId)
  const activePageId = useNavigationSelectionStore((state) => state.activePageId)
  const selectPage = useNavigationSelectionStore((state) => state.selectPage)
  const selectSection = useNavigationSelectionStore((state) => state.selectSection)
  const [dailySourceSaving, setDailySourceSaving] = useState(false)

  useEffect(() => {
    if (userId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset mutation status on sign-out
    setDailySourceSaving(false)
  }, [userId])

  // Reordering can target any expanded section, not only the active one.
  //
  // `nextPages` is the VISIBLE subset — drag-and-drop computes drop indices
  // against the list the tree renders. So it is merged into what is already
  // cached rather than replacing it: a plain replace would evict every hidden
  // Library page from the cache that resolves an open page, and they would stay
  // gone until the next refetch. Only the reordered rows are persisted, so a
  // hidden page keeps its sentinel sort_order.
  const reorderSectionPages = useCallback(
    async (sectionId, nextPages) => {
      if (!userId || !sectionId || !Array.isArray(nextPages)) return
      const reordered = reindexSortOrder(nextPages)
      const applyLocally = () => {
        mergeSectionPageOrder(sectionId, reordered)
        if (sectionId === activeSectionId) {
          setPages((previous) => mergeReorderedPages(previous, reordered))
        }
      }
      applyLocally()

      const updates = reordered.map((item) =>
        supabase.from('pages').update({ sort_order: item.sort_order }).eq('id', item.id),
      )
      const results = await Promise.all(updates)
      const error = results.find((result) => result.error)?.error
      if (error) {
        setMessage(error.message)
        return
      }

      applyLocally()
    },
    [activeSectionId, mergeSectionPageOrder, setMessage, setPages, userId],
  )

  const createPage = async (session, sectionId) => {
    if (!session || !sectionId) return
    setMessage('')
    const title = 'Untitled'
    const provisionalSortOrder = getNextSortOrder(pages)
    const { data, error } = await insertPage({
      session, sectionId, title, content: EMPTY_DOC, sortOrder: provisionalSortOrder,
    })

    if (error) {
      setMessage(error.message)
      return
    }

    const created = { ...toClientPage(data), sort_order: provisionalSortOrder }
    // New pages appear immediately after the selected page, then use the same
    // persisted reorder path as drag-and-drop.
    const desiredOrder = insertPageAfter(pages, created, activePageId)
    await reorderSectionPages(sectionId, desiredOrder)
    setPageContent(data.id, EMPTY_DOC, data.updated_at)
    selectPage(activeNotebookId, sectionId, data.id)
  }

  /**
   * Create a Library topic page.
   *
   * The one page the user may author in a Library — and "author" only in the
   * sense of naming it. Rule 2 is that topics exist ONLY because the user made
   * one, and this is the app-side half of that: a suggestion card or the "make
   * your own" modal, never the model.
   *
   * It starts EMPTY and gathers, per the 19 Aug decision. No backfill and no
   * second model call: what belongs to it is decided at capture time from here
   * on, which is the same rule every other topic follows.
   */
  const createLibraryTopicPage = async (session, sectionId, pageTitle) => {
    const title = String(pageTitle ?? '').trim()
    if (!session || !sectionId || !title) return null
    setMessage('')
    const nextSortOrder = getNextSortOrder(pages)
    const content = buildNewTopicDoc()
    const { data, error } = await insertPage({
      session,
      sectionId,
      title,
      content,
      sortOrder: nextSortOrder,
      libraryRole: 'topic',
    })

    if (error) {
      setMessage(error.message)
      return null
    }

    const created = { ...toClientPage(data), sort_order: nextSortOrder }
    setPages((previous) => [...previous, created])
    upsertCachedPage(sectionId, created)
    setPageContent(data.id, content, data.updated_at)
    selectPage(activeNotebookId, sectionId, data.id)
    return created
  }

  const createPageWithContent = async (session, sectionId, pageTitle, content) => {
    if (!session || !sectionId) return null
    setMessage('')
    const nextSortOrder = getNextSortOrder(pages)
    const { data, error } = await insertPage({
      session, sectionId, title: pageTitle, content, sortOrder: nextSortOrder,
    })

    if (error) {
      setMessage(error.message)
      return null
    }

    const created = { ...toClientPage(data), sort_order: nextSortOrder }
    setPages((previous) => [...previous, created])
    upsertCachedPage(sectionId, created)
    setPageContent(data.id, content, data.updated_at)
    selectPage(activeNotebookId, sectionId, data.id)
    return created
  }

  const setDailySourcePage = useCallback(
    async (pageId) => {
      if (!userId || !activeSectionId || !pageId) return
      const currentPages = pagesRef.current
      const target = currentPages.find((item) => item.id === pageId)
      if (!target || target.isDailySource) return

      setMessage('')
      setDailySourceSaving(true)
      setPages((previous) =>
        previous.map((item) => ({
          ...item,
          isDailySource: item.id === pageId,
        })),
      )
      markCachedDailySourcePage(activeSectionId, pageId)

      const { error: clearError } = await supabase
        .from('pages')
        .update({ is_tracker_page: false })
        .eq('section_id', activeSectionId)
        .eq('user_id', userId)
        .eq('is_tracker_page', true)

      if (clearError) {
        setPages(currentPages)
        setMessage(clearError.message)
        seedSectionPages(activeSectionId, currentPages)
        setDailySourceSaving(false)
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
        setPages(currentPages)
        setMessage(setError.message)
        await loadPages(activeSectionId)
        setDailySourceSaving(false)
        return
      }

      setDailySourceSaving(false)
    },
    [
      activeSectionId,
      loadPages,
      markCachedDailySourcePage,
      seedSectionPages,
      setMessage,
      setPages,
      pagesRef,
      userId,
    ],
  )

  const deletePage = async (pageToDelete = null) => {
    const page =
      pageToDelete != null &&
      typeof pageToDelete === 'object' &&
      typeof pageToDelete.id === 'string' &&
      typeof pageToDelete.title === 'string' &&
      !('nativeEvent' in pageToDelete)
        ? pageToDelete
        : activePageRef.current
    if (!page) return
    const confirmDelete = window.confirm(`Delete "${page.title}"? This cannot be undone.`)
    if (!confirmDelete) return

    const pageContent = pageContentCacheRef.current[page.id]?.content ?? null
    const imagePaths = collectAllImagePaths([{ ...page, content: pageContent }])
    const { error } = await supabase.from('pages').delete().eq('id', page.id)

    if (error) {
      setMessage(error.message)
      return
    }

    if (imagePaths.length > 0) {
      void deleteImagesFromStorage(imagePaths)
    }

    clearNavHierarchyCache()
    const deletedIndex = pages.findIndex((item) => item.id === page.id)
    const nextPages = pages.filter((item) => item.id !== page.id)
    setPages(nextPages)
    removeCachedPage(page.section_id ?? activeSectionId, page.id)
    clearPendingTitle(page.id)
    clearPageDraft(page.id)
    const selection = useNavigationSelectionStore.getState()
    if (selection.activePageId === page.id) {
      const nextPageId =
        getPostDeleteTarget?.(nextPages, page.id, deletedIndex) ??
        nextPages[0]?.id ??
        null
      if (nextPageId) {
        selectPage(selection.activeNotebookId, selection.activeSectionId, nextPageId)
      } else {
        selectSection(selection.activeNotebookId, selection.activeSectionId)
      }
    }
  }

  return {
    dailySourceSaving,
    createPage,
    createPageWithContent,
    createLibraryTopicPage,
    reorderSectionPages,
    setDailySourcePage,
    deletePage,
  }
}
