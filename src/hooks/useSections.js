import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { COLOR_PALETTE } from '../utils/constants'
import {
  deleteImagesFromStorage,
  collectImagePathsForCleanup,
} from '../utils/imageCleanup'
import { clearNavHierarchyCache } from '../utils/resolveNavHierarchy'
import { runSupabaseQueryWithRetry } from '../utils/supabaseRetry'
import { reindexSortOrder } from '../utils/sidebarReorder'
import { useNavigationSelectionStore } from '../stores/navigationSelectionStore'
import { remapCopiedContents } from './sections/remapCopiedContent'

export const useSections = (userId, getPostDeleteTarget = null) => {
  const [sections, setSections] = useState([])
  const activeNotebookId = useNavigationSelectionStore((state) => state.activeNotebookId)
  const activeSectionId = useNavigationSelectionStore((state) => state.activeSectionId)
  const selectSection = useNavigationSelectionStore((state) => state.selectSection)
  const [sectionsLoading, setSectionsLoading] = useState(false)
  const [loadedUserId, setLoadedUserId] = useState(null)
  const [message, setMessage] = useState('')
  const loadRequestIdRef = useRef(0)

  const loadSections = useCallback(async () => {
    if (!userId) return
    const requestId = ++loadRequestIdRef.current
    setSectionsLoading(true)
    setMessage('')
    const { data, error } = await runSupabaseQueryWithRetry(() =>
      supabase
        .from('sections')
        .select('id, title, color, sort_order, notebook_id, created_at, updated_at')
        .order('sort_order', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: true }),
    )

    if (loadRequestIdRef.current !== requestId) return

    if (error) {
      setMessage(error.message)
      setLoadedUserId(userId)
      setSectionsLoading(false)
      return
    }

    setSections(data ?? [])
    setLoadedUserId(userId)
    setSectionsLoading(false)
  }, [userId])

  // Load all sections once on login; clear on logout
  useEffect(() => {
    if (!userId) {
      loadRequestIdRef.current += 1
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset section state when the userId prop clears (logout)
      setSections([])
      setSectionsLoading(false)
      setLoadedUserId(null)
      setMessage('')
      return
    }
    void loadSections()
  }, [userId, loadSections])

  // Once sections are loaded, fill in a missing/invalid descendant for the
  // selected notebook. Complete deep-link selections survive loading unchanged.
  useEffect(() => {
    if (!userId || loadedUserId !== userId || sectionsLoading || !activeNotebookId) return
    const notebookSections = sections.filter((s) => s.notebook_id === activeNotebookId)
    if (activeSectionId && notebookSections.some((s) => s.id === activeSectionId)) return
    selectSection(activeNotebookId, notebookSections[0]?.id ?? null)
  }, [
    activeNotebookId,
    activeSectionId,
    loadedUserId,
    sections,
    sectionsLoading,
    selectSection,
    userId,
  ])

  const createSection = async (session, notebookId) => {
    if (!session || !notebookId) return
    const title = window.prompt('Section name', 'New Section')
    if (!title) return
    const color = COLOR_PALETTE[sections.length % COLOR_PALETTE.length]
    const { data, error } = await supabase
      .from('sections')
      .insert({
        title: title.trim(),
        user_id: session.user.id,
        notebook_id: notebookId,
        color,
      })
      .select()
      .single()

    if (error) {
      setMessage(error.message)
      return
    }

    setSections((prev) => [...prev, data])
    selectSection(notebookId, data.id)
  }

  const renameSection = async (section) => {
    if (!section) return
    const nextTitle = window.prompt('Rename section', section.title)
    if (!nextTitle) return
    const { error } = await supabase
      .from('sections')
      .update({ title: nextTitle.trim(), updated_at: new Date().toISOString() })
      .eq('id', section.id)

    if (error) {
      setMessage(error.message)
      return
    }

    setSections((prev) =>
      prev.map((item) => (item.id === section.id ? { ...item, title: nextTitle.trim() } : item)),
    )
  }

  const deleteSection = async (section) => {
    if (!section) return
    const confirmDelete = window.confirm(
      `Delete "${section.title}"? This will delete all pages in this section.`,
    )
    if (!confirmDelete) return

    // Collect image paths from all pages in this section before cascade delete.
    const { imagePaths, error: pagesError } = await collectImagePathsForCleanup(() =>
      runSupabaseQueryWithRetry(() =>
        supabase
          .from('pages')
          .select('id, content')
          .eq('section_id', section.id)
          .order('id'),
      ),
    )

    if (pagesError) {
      setMessage(pagesError.message)
      return
    }

    const { error } = await supabase.from('sections').delete().eq('id', section.id)

    if (error) {
      setMessage(error.message)
      return
    }

    // Clean up images after successful DB delete (fire-and-forget).
    if (imagePaths.length > 0) {
      deleteImagesFromStorage(imagePaths)
    }

    clearNavHierarchyCache()
    const selection = useNavigationSelectionStore.getState()
    const notebookSectionsBefore = sections.filter((s) => s.notebook_id === selection.activeNotebookId)
    const deletedIndex = notebookSectionsBefore.findIndex((s) => s.id === section.id)
    const nextSections = sections.filter((item) => item.id !== section.id)
    setSections(nextSections)
    const notebookSections = nextSections.filter((s) => s.notebook_id === selection.activeNotebookId)
    // Land on the most-recent previous section (else the adjacent sibling).
    if (selection.activeSectionId === section.id) {
      selectSection(
        selection.activeNotebookId,
        getPostDeleteTarget?.(notebookSections, section.id, deletedIndex) ??
          notebookSections[0]?.id ??
          null,
      )
    }
  }

  const moveSection = async (section, destNotebookId) => {
    if (!section || !destNotebookId) return false
    const { error } = await supabase
      .from('sections')
      .update({ notebook_id: destNotebookId, updated_at: new Date().toISOString() })
      .eq('id', section.id)

    if (error) {
      setMessage(error.message)
      return false
    }

    clearNavHierarchyCache()
    setSections((prev) =>
      prev.map((item) =>
        item.id === section.id ? { ...item, notebook_id: destNotebookId } : item,
      ),
    )
    return true
  }

  const waitForSectionVisibility = useCallback(async (sectionId, timeoutMs = 5000) => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const { data, error } = await runSupabaseQueryWithRetry(() =>
        supabase
          .from('sections')
          .select('id')
          .eq('id', sectionId)
          .maybeSingle(),
      )

      if (error) {
        throw error
      }

      if (data?.id === sectionId) {
        return
      }

      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    throw new Error(`Timed out waiting for section ${sectionId} to become readable`)
  }, [])

  const getUniqueSectionTitle = async (title, destNotebookId) => {
    const localTitles =
      destNotebookId === activeNotebookId
        ? sections
            .filter((section) => section?.title)
            .map((section) => section.title)
        : []

    const { data: existing, error } = await runSupabaseQueryWithRetry(() =>
      supabase
        .from('sections')
        .select('title')
        .eq('notebook_id', destNotebookId),
    )

    if (error) {
      throw error
    }

    const titles = new Set([
      ...localTitles,
      ...(existing ?? []).map((section) => section.title).filter(Boolean),
    ])
    if (!titles.has(title)) return title

    let counter = 1
    while (titles.has(`${title} (${counter})`)) {
      counter++
    }
    return `${title} (${counter})`
  }

  const copySection = async (section, destNotebookId, session) => {
    if (!section || !destNotebookId || !session) return
    let uniqueTitle = null
    try {
      uniqueTitle = await getUniqueSectionTitle(section.title, destNotebookId)
    } catch (error) {
      setMessage(error.message)
      return
    }

    const { data: newSection, error: sectionError } = await supabase
      .from('sections')
      .insert({
        title: uniqueTitle,
        color: section.color,
        user_id: session.user.id,
        notebook_id: destNotebookId,
      })
      .select()
      .single()

    if (sectionError) {
      setMessage(sectionError.message)
      return
    }

    try {
      await waitForSectionVisibility(newSection.id)
    } catch (error) {
      setMessage(error.message)
      return
    }

    const { data: sourcePages, error: fetchError } = await supabase
      .from('pages')
      .select('id, title, content, sort_order, is_tracker_page')
      .eq('section_id', section.id)

    if (fetchError) {
      setMessage(fetchError.message)
      return
    }

    if (sourcePages && sourcePages.length > 0) {
      // Phase 1: Insert pages to get new IDs and build page ID mapping
      const pageIdMap = {}
      const insertedPages = []
      for (const page of sourcePages) {
        const { data: newPage, error: insertError } = await supabase
          .from('pages')
          .insert({
            title: page.title,
            content: page.content,
            sort_order: page.sort_order,
            is_tracker_page: page.is_tracker_page,
            section_id: newSection.id,
            user_id: session.user.id,
          })
          .select('id')
          .single()

        if (insertError) {
          setMessage(insertError.message)
          return
        }
        pageIdMap[page.id] = newPage.id
        insertedPages.push(newPage.id)
      }

      // Phase 2: Regenerate block IDs and rewrite all copied-section links.
      const remappedContents = remapCopiedContents(
        sourcePages.map((page) => page.content),
        {
          pageIdMap,
          sectionId: { old: section.id, new: newSection.id },
          notebookId: { old: activeNotebookId, new: destNotebookId },
        },
      )

      // Phase 3: Persist the transformed contents after every copied page has an ID.
      const updates = remappedContents.map((content, i) => {
        if (!content) return null
        return supabase
          .from('pages')
          .update({ content })
          .eq('id', insertedPages[i])
      }).filter(Boolean)

      if (updates.length > 0) {
        const results = await Promise.all(updates)
        const firstError = results.find((r) => r.error)?.error
        if (firstError) {
          setMessage(firstError.message)
        }
      }
    }

    // Add the new section after all pages and content are fully copied
    setSections((prev) => [...prev, newSection])
  }

  // Reorder the sections within a single notebook (drag-and-drop). State holds
  // every notebook's sections in one flat array, so reindex just the notebook's
  // slice and merge it back into the global array: keep other notebooks'
  // sections in their existing slots and drop the reordered slice into the slots
  // that previously held this notebook's sections.
  const reorderSections = useCallback(
    async (notebookId, nextSectionsForNotebook) => {
      if (!userId || !notebookId || !Array.isArray(nextSectionsForNotebook)) return
      const reordered = reindexSortOrder(nextSectionsForNotebook)
      const reorderedById = new Map(reordered.map((section) => [section.id, section]))

      setSections((prev) => {
        const queue = [...reordered]
        return prev.map((section) => {
          if (section.notebook_id !== notebookId) return section
          // Replace this notebook's slot with the next reordered section. Fall
          // back to the reindexed copy by id if the slice length somehow drifts.
          return queue.shift() ?? reorderedById.get(section.id) ?? section
        })
      })

      const updates = reordered.map((item) =>
        supabase.from('sections').update({ sort_order: item.sort_order }).eq('id', item.id),
      )
      const results = await Promise.all(updates)
      const error = results.find((result) => result.error)?.error
      if (error) {
        setMessage(error.message)
      }
    },
    [userId],
  )

  const activeSection = sections.find((section) => section.id === activeSectionId) ?? null

  return {
    sections,
    sectionsLoading,
    activeSectionId,
    activeSection,
    message,
    setMessage,
    createSection,
    renameSection,
    deleteSection,
    moveSection,
    copySection,
    reorderSections,
  }
}
