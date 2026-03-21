import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { deleteImagesFromStorage, collectAllImagePaths } from '../utils/imageCleanup'

export const useNotebooks = (userId, pendingNavRef, savedSelectionRef) => {
  const [notebooks, setNotebooks] = useState([])
  const [activeNotebookId, setActiveNotebookId] = useState(null)
  const [message, setMessage] = useState('')

  const loadNotebooks = useCallback(async () => {
    if (!userId) return
    setMessage('')
    const { data, error } = await supabase
      .from('notebooks')
      .select('id, title, sort_order, created_at, updated_at')
      .order('sort_order', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: true })

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
        setNotebooks([])
        setActiveNotebookId(null)
        setMessage('')
        return
      }
      void loadNotebooks()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [userId, loadNotebooks])

  const createNotebook = async (session) => {
    if (!session) return
    const title = window.prompt('Notebook name', 'My Notebook')
    if (!title) return
    const { data, error } = await supabase
      .from('notebooks')
      .insert({
        title: title.trim(),
        user_id: session.user.id,
      })
      .select()
      .single()

    if (error) {
      setMessage(error.message)
      return
    }

    setNotebooks((prev) => [...prev, data])
    setActiveNotebookId(data.id)
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
    const { data: sectionRows, error: sectionsError } = await supabase
      .from('sections')
      .select('id')
      .eq('notebook_id', notebook.id)

    if (sectionsError) {
      setMessage(sectionsError.message)
      return
    }

    let imagePaths = []
    const sectionIds = (sectionRows ?? []).map((s) => s.id)
    if (sectionIds.length > 0) {
      const { data: pages, error: pagesError } = await supabase
        .from('pages')
        .select('id, content')
        .in('section_id', sectionIds)
        .order('id')

      if (pagesError) {
        setMessage(pagesError.message)
        return
      }

      imagePaths = collectAllImagePaths(pages ?? [])
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

    const nextNotebooks = notebooks.filter((item) => item.id !== notebook.id)
    setNotebooks(nextNotebooks)
    setActiveNotebookId(nextNotebooks[0]?.id ?? null)
  }

  const activeNotebook = notebooks.find((notebook) => notebook.id === activeNotebookId) ?? null

  return {
    notebooks,
    activeNotebookId,
    setActiveNotebookId,
    activeNotebook,
    message,
    setMessage,
    createNotebook,
    renameNotebook,
    deleteNotebook,
  }
}
