import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import {
  deleteImagesFromStorage,
  collectImagePathsForCleanup,
} from '../utils/imageCleanup'
import { clearNavHierarchyCache } from '../utils/resolveNavHierarchy'
import { runSupabaseQueryWithRetry } from '../utils/supabaseRetry'

export const useNotebooks = (userId, pendingNavRef, savedSelectionRef) => {
  const [notebooks, setNotebooks] = useState([])
  const [activeNotebookId, setActiveNotebookId] = useState(null)
  const [message, setMessage] = useState('')
  const loadRequestIdRef = useRef(0)

  const loadNotebooks = useCallback(async () => {
    if (!userId) return
    const requestId = ++loadRequestIdRef.current
    setMessage('')
    const { data, error } = await runSupabaseQueryWithRetry(() =>
      supabase
        .from('notebooks')
        .select('id, title, type, sort_order, created_at, updated_at')
        .order('sort_order', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: true }),
    )

    if (loadRequestIdRef.current !== requestId) return

    if (error) {
      setMessage(error.message)
      return
    }

    setNotebooks(data ?? [])
    const pending = pendingNavRef?.current
    const saved = savedSelectionRef?.current
    if (pending?.notebookId && data?.some((item) => item.id === pending.notebookId)) {
      setActiveNotebookId(pending.notebookId)
    } else {
      setActiveNotebookId((prev) => {
        if (prev && data?.some((item) => item.id === prev)) return prev
        if (saved?.notebookId && data?.some((item) => item.id === saved.notebookId)) {
          return saved.notebookId
        }
        return data?.[0]?.id ?? null
      })
    }
  }, [userId, pendingNavRef, savedSelectionRef])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!userId) {
        loadRequestIdRef.current += 1
        setNotebooks([])
        setActiveNotebookId(null)
        setMessage('')
        return
      }
      void loadNotebooks()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [userId, loadNotebooks])

  const createNotebook = async (session, { type = 'tracker', title: overrideTitle } = {}) => {
    if (!session) return null
    const title = overrideTitle ?? window.prompt('Notebook name', 'My Notebook')
    if (!title) return null
    const { data, error } = await supabase
      .from('notebooks')
      .insert({
        title: title.trim(),
        user_id: session.user.id,
        type,
      })
      .select()
      .single()

    if (error) {
      setMessage(error.message)
      return null
    }

    setNotebooks((prev) => [...prev, data])
    setActiveNotebookId(data.id)
    return data
  }

  const renameNotebook = async (notebook) => {
    if (!notebook) return
    const nextTitle = window.prompt('Rename notebook', notebook.title)
    if (!nextTitle) return
    const { error } = await supabase
      .from('notebooks')
      .update({ title: nextTitle.trim(), updated_at: new Date().toISOString() })
      .eq('id', notebook.id)

    if (error) {
      setMessage(error.message)
      return
    }

    setNotebooks((prev) =>
      prev.map((item) => (item.id === notebook.id ? { ...item, title: nextTitle.trim() } : item)),
    )
  }

  const deleteNotebook = async (notebook) => {
    if (!notebook) return
    const confirmDelete = window.confirm(
      `Delete "${notebook.title}"? This will delete all its sections and pages.`,
    )
    if (!confirmDelete) return

    // Collect image paths from all pages in this notebook before cascade delete.
    // Join through sections to find all pages belonging to this notebook.
    const { imagePaths, error: pagesError } = await collectImagePathsForCleanup(async () => {
      const { data: sectionRows, error: sectionsError } = await runSupabaseQueryWithRetry(() =>
        supabase
          .from('sections')
          .select('id')
          .eq('notebook_id', notebook.id),
      )

      if (sectionsError) {
        return { data: null, error: sectionsError }
      }

      const sectionIds = (sectionRows ?? []).map((sectionRow) => sectionRow.id)
      if (sectionIds.length === 0) {
        return { data: [], error: null }
      }

      return runSupabaseQueryWithRetry(() =>
        supabase
          .from('pages')
          .select('id, content')
          .in('section_id', sectionIds)
          .order('id'),
      )
    })

    if (pagesError) {
      setMessage(pagesError.message)
      return
    }

    const { error } = await supabase.from('notebooks').delete().eq('id', notebook.id)

    if (error) {
      setMessage(error.message)
      return
    }

    // Clean up images after successful DB delete (fire-and-forget).
    if (imagePaths.length > 0) {
      deleteImagesFromStorage(imagePaths)
    }

    clearNavHierarchyCache()
    const nextNotebooks = notebooks.filter((item) => item.id !== notebook.id)
    setNotebooks(nextNotebooks)
    if (notebook.id === activeNotebookId) {
      setActiveNotebookId(nextNotebooks[0]?.id ?? null)
    }
  }

  const activeNotebook = notebooks.find((notebook) => notebook.id === activeNotebookId) ?? null
  const activeNotebookType = activeNotebook?.type ?? 'tracker'
  const isRecipesNotebook = activeNotebookType === 'recipes'

  // Auto-create the Recipes notebook (+ "General" section) on first load if missing.
  const recipesInitRef = useRef(false)
  useEffect(() => {
    if (!userId || notebooks.length === 0 || recipesInitRef.current) return
    const hasRecipes = notebooks.some((nb) => nb.type === 'recipes')
    if (hasRecipes) {
      recipesInitRef.current = true
      return
    }
    recipesInitRef.current = true
    // We need a session to create — fetch it once
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const nb = await createNotebook(session, { type: 'recipes', title: 'Recipes' })
      if (!nb) return
      // Create a default "General" section
      const { error: sectionError } = await supabase
        .from('sections')
        .insert({ title: 'General', user_id: session.user.id, notebook_id: nb.id, sort_order: 0 })
      if (sectionError) console.error('Failed to create default Recipes section:', sectionError.message)
    })()
  }, [userId, notebooks]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    notebooks,
    activeNotebookId,
    setActiveNotebookId,
    activeNotebook,
    message,
    setMessage,
    activeNotebookType,
    isRecipesNotebook,
    createNotebook,
    renameNotebook,
    deleteNotebook,
  }
}
