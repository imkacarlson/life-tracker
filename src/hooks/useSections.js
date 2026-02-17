import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { COLOR_PALETTE } from '../utils/constants'

export const useSections = (userId, activeNotebookId, pendingNavRef, savedSelectionRef) => {
  const [sections, setSections] = useState([])
  const [activeSectionId, setActiveSectionId] = useState(null)
  const [message, setMessage] = useState('')

  const loadSections = useCallback(
    async (notebookId) => {
      if (!userId || !notebookId) return
      setMessage('')
      const { data, error } = await supabase
        .from('sections')
        .select('id, title, color, sort_order, created_at, updated_at')
        .eq('notebook_id', notebookId)
        .order('sort_order', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: true })

      if (error) {
        setMessage(error.message)
        return
      }

      setSections(data ?? [])
      const pending = pendingNavRef?.current
      const saved = savedSelectionRef?.current
      if (pending?.sectionId && data?.some((item) => item.id === pending.sectionId)) {
        setActiveSectionId(pending.sectionId)
      } else {
        setActiveSectionId((prev) => {
          if (prev && data?.some((item) => item.id === prev)) return prev
          if (saved?.sectionId && data?.some((item) => item.id === saved.sectionId)) {
            return saved.sectionId
          }
          return data?.[0]?.id ?? null
        })
      }
    },
    [userId, pendingNavRef, savedSelectionRef],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!userId || !activeNotebookId) {
        setSections([])
        setActiveSectionId(null)
        setMessage('')
        return
      }
      setSections([])
      setActiveSectionId(null)
      void loadSections(activeNotebookId)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [userId, activeNotebookId, loadSections])

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
    setActiveSectionId(data.id)
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

    const { error } = await supabase.from('sections').delete().eq('id', section.id)

    if (error) {
      setMessage(error.message)
      return
    }

    const nextSections = sections.filter((item) => item.id !== section.id)
    setSections(nextSections)
    setActiveSectionId((prev) => (prev === section.id ? nextSections[0]?.id ?? null : prev))
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

    setSections((prev) => prev.filter((item) => item.id !== section.id))
    return true
  }

  const copySection = async (section, destNotebookId, session) => {
    if (!section || !destNotebookId || !session) return
    const { data: newSection, error: sectionError } = await supabase
      .from('sections')
      .insert({
        title: section.title,
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

    const { data: sourcePages, error: fetchError } = await supabase
      .from('pages')
      .select('title, content, sort_order, is_tracker_page')
      .eq('section_id', section.id)

    if (fetchError) {
      setMessage(fetchError.message)
      return
    }

    if (sourcePages && sourcePages.length > 0) {
      const pageInserts = sourcePages.map((page) =>
        supabase.from('pages').insert({
          title: page.title,
          content: page.content,
          sort_order: page.sort_order,
          is_tracker_page: page.is_tracker_page,
          section_id: newSection.id,
          user_id: session.user.id,
        }),
      )
      const results = await Promise.all(pageInserts)
      const firstError = results.find((r) => r.error)?.error
      if (firstError) {
        setMessage(firstError.message)
      }
    }
  }

  const activeSection = sections.find((section) => section.id === activeSectionId) ?? null

  return {
    sections,
    activeSectionId,
    setActiveSectionId,
    activeSection,
    message,
    setMessage,
    createSection,
    renameSection,
    deleteSection,
    moveSection,
    copySection,
  }
}
