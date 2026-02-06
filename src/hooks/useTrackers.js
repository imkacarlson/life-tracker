import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { EMPTY_DOC } from '../utils/constants'
import { sanitizeContentForSave } from '../utils/contentHelpers'

export const useTrackers = (userId, activeSectionId, pendingNavRef, savedSelectionRef) => {
  const [trackers, setTrackers] = useState([])
  const [activeTrackerId, setActiveTrackerId] = useState(null)
  const [dataLoading, setDataLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const [saveStatus, setSaveStatus] = useState('Saved')

  const saveTimerRef = useRef(null)
  const titleDraftRef = useRef(titleDraft)
  const activeTrackerRef = useRef(null)
  const trackersRef = useRef(trackers)

  const activeTracker = trackers.find((tracker) => tracker.id === activeTrackerId) ?? null

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
    setMessage('')
    setTitleDraft('')
    setSaveStatus('Saved')
  }, [userId])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  const loadTrackers = useCallback(
    async (sectionId) => {
      if (!userId || !sectionId) return
      setDataLoading(true)
      setMessage('')
      const { data, error } = await supabase
        .from('pages')
        .select('id, title, content, created_at, updated_at, section_id, sort_order')
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
    setSaveStatus('Saved')
  }, [activeTrackerId, activeTracker])

  const scheduleSave = useCallback(
    (nextContent, nextTitle, trackerIdOverride = null) => {
      const trackerId = trackerIdOverride ?? activeTrackerRef.current?.id
      if (!trackerId) return
      const tracker = trackersRef.current.find((item) => item.id === trackerId)
      if (!tracker) return

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }

      const fallbackTitle =
        trackerIdOverride && !nextTitle ? tracker.title : titleDraftRef.current
      const title = (nextTitle ?? fallbackTitle)?.trim() || 'Untitled Tracker'
      const payload = {
        title,
        content: sanitizeContentForSave(nextContent),
        updated_at: new Date().toISOString(),
      }

      setSaveStatus('Saving...')

      saveTimerRef.current = setTimeout(async () => {
        const { error } = await supabase.from('pages').update(payload).eq('id', trackerId)

        if (error) {
          setMessage(error.message)
          setSaveStatus('Error')
          return
        }

        setTrackers((prev) =>
          prev.map((item) => (item.id === trackerId ? { ...item, ...payload } : item)),
        )
        setSaveStatus('Saved')
      }, 2000)
    },
    [],
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
    setActiveTrackerId((prev) => (prev === tracker.id ? nextTrackers[0]?.id ?? null : prev))
  }

  return {
    trackers,
    activeTrackerId,
    setActiveTrackerId,
    activeTracker,
    titleDraft,
    setTitleDraft,
    saveStatus,
    setSaveStatus,
    dataLoading,
    message,
    setMessage,
    scheduleSave,
    handleTitleChange,
    createTracker,
    reorderTrackers,
    deleteTracker,
    activeTrackerRef,
  }
}
