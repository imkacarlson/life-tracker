import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { COLOR_PALETTE } from '../utils/constants'

const NODE_TYPES_WITH_IDS = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'table'])

// Regenerate block IDs in Tiptap JSON, returning the remapped content and an old→new ID map.
// idMaps: { pageIdMap, sectionId: { old, new }, notebookId: { old, new } }
const remapContentIds = (content, idMaps) => {
  const blockIdMap = {}
  const { pageIdMap, sectionId, notebookId } = idMaps

  const walkNodes = (node) => {
    if (!node) return node
    const out = { ...node }

    // Regenerate block IDs for navigable node types
    if (NODE_TYPES_WITH_IDS.has(node.type) && node.attrs?.id) {
      const newId = crypto.randomUUID()
      blockIdMap[node.attrs.id] = newId
      out.attrs = { ...node.attrs, id: newId, created_at: new Date().toISOString() }
    }

    // Rewrite internal link hrefs in text marks
    if (node.marks) {
      out.marks = node.marks.map((mark) => {
        if (mark.type !== 'link' || !mark.attrs?.href) return mark
        const href = mark.attrs.href
        if (!href.startsWith('#pg=') && !href.startsWith('#sec=') && !href.startsWith('#nb=')) return mark

        const params = new URLSearchParams(href.slice(1))
        let changed = false

        const oldNb = params.get('nb')
        if (oldNb && notebookId && oldNb === notebookId.old) {
          params.set('nb', notebookId.new)
          changed = true
        }

        const oldSec = params.get('sec')
        if (oldSec && sectionId && oldSec === sectionId.old) {
          params.set('sec', sectionId.new)
          changed = true
        }

        const oldPageId = params.get('pg')
        if (oldPageId && pageIdMap[oldPageId]) {
          params.set('pg', pageIdMap[oldPageId])
          changed = true
        }

        const oldBlockId = params.get('block')
        if (oldBlockId && blockIdMap[oldBlockId]) {
          params.set('block', blockIdMap[oldBlockId])
          changed = true
        }

        if (!changed) return mark
        return { ...mark, attrs: { ...mark.attrs, href: `#${params.toString()}` } }
      })
    }

    if (node.content) {
      out.content = node.content.map(walkNodes)
    }

    return out
  }

  const remapped = walkNodes(content)
  return { content: remapped, blockIdMap }
}

// Second pass: rewrite any block references that were encountered before their new ID was generated
const fixForwardBlockRefs = (content, blockIdMap) => {
  const walk = (node) => {
    if (!node) return node
    const out = { ...node }

    if (node.marks) {
      out.marks = node.marks.map((mark) => {
        if (mark.type !== 'link' || !mark.attrs?.href) return mark
        const href = mark.attrs.href
        if (!href.startsWith('#')) return mark

        const params = new URLSearchParams(href.slice(1))
        const blockId = params.get('block')
        if (blockId && blockIdMap[blockId]) {
          params.set('block', blockIdMap[blockId])
          return { ...mark, attrs: { ...mark.attrs, href: `#${params.toString()}` } }
        }
        return mark
      })
    }

    if (node.content) {
      out.content = node.content.map(walk)
    }

    return out
  }

  return walk(content)
}

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

  const getUniqueSectionTitle = async (title, destNotebookId) => {
    const { data: existing } = await supabase
      .from('sections')
      .select('title')
      .eq('notebook_id', destNotebookId)

    const titles = new Set((existing ?? []).map((s) => s.title))
    if (!titles.has(title)) return title

    let counter = 1
    while (titles.has(`${title} (${counter})`)) {
      counter++
    }
    return `${title} (${counter})`
  }

  const copySection = async (section, destNotebookId, session) => {
    if (!section || !destNotebookId || !session) return
    const uniqueTitle = await getUniqueSectionTitle(section.title, destNotebookId)
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

    // Show the new section immediately if copying within the active notebook
    if (destNotebookId === activeNotebookId) {
      setSections((prev) => [...prev, newSection])
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

      // Phase 2: Remap block IDs and internal links in each copied page
      const allBlockIds = {}
      const remappedContents = []
      for (let i = 0; i < sourcePages.length; i++) {
        if (!sourcePages[i].content) {
          remappedContents.push(null)
          continue
        }
        const idMaps = {
          pageIdMap,
          sectionId: { old: section.id, new: newSection.id },
          notebookId: { old: activeNotebookId, new: destNotebookId },
        }
        const { content: remapped, blockIdMap } = remapContentIds(sourcePages[i].content, idMaps)
        Object.assign(allBlockIds, blockIdMap)
        remappedContents.push(remapped)
      }

      // Phase 3: Fix forward block references (links that appeared before their target was remapped)
      const updates = remappedContents.map((content, i) => {
        if (!content) return null
        const fixed = fixForwardBlockRefs(content, allBlockIds)
        return supabase
          .from('pages')
          .update({ content: fixed })
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
