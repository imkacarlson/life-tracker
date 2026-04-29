import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { runSupabaseQueryWithRetry } from '../utils/supabaseRetry'
import {
  SECTION_PAGE_STATUS,
  getSectionPageEntry,
  removeSectionPage,
  setSectionPagesError,
  setSectionPagesLoaded,
  setSectionPagesLoading,
  setSectionTrackerPage,
  updateSectionPage,
  upsertSectionPage,
} from '../utils/sectionPages'

export function useSectionPageCache(userId) {
  const [sectionPageCache, setSectionPageCache] = useState({})
  const cacheRef = useRef(sectionPageCache)
  const inFlightBySectionRef = useRef({})
  const userIdRef = useRef(userId)

  useEffect(() => {
    cacheRef.current = sectionPageCache
  }, [sectionPageCache])

  useEffect(() => {
    userIdRef.current = userId
    if (userId) return
    inFlightBySectionRef.current = {}
    setSectionPageCache({})
  }, [userId])

  const seedSectionPages = useCallback((sectionId, pages) => {
    if (!sectionId) return
    setSectionPageCache((prev) => setSectionPagesLoaded(prev, sectionId, pages ?? []))
  }, [])

  const markSectionPagesLoading = useCallback((sectionId) => {
    if (!sectionId) return
    setSectionPageCache((prev) => setSectionPagesLoading(prev, sectionId))
  }, [])

  const markSectionPagesError = useCallback((sectionId, error) => {
    if (!sectionId) return
    setSectionPageCache((prev) => setSectionPagesError(prev, sectionId, error))
  }, [])

  const loadSectionPagesMeta = useCallback(
    async (sectionId, { force = false } = {}) => {
      if (!userId || !sectionId) return

      const current = getSectionPageEntry(cacheRef.current, sectionId)
      if (!force && current.status === SECTION_PAGE_STATUS.LOADED) return
      if (!force && current.status === SECTION_PAGE_STATUS.LOADING) return
      if (inFlightBySectionRef.current[sectionId]) return

      inFlightBySectionRef.current[sectionId] = true
      markSectionPagesLoading(sectionId)

      const { data, error } = await runSupabaseQueryWithRetry(() =>
        supabase
          .from('pages')
          .select('id, title, section_id, sort_order, is_tracker_page')
          .eq('section_id', sectionId)
          .order('sort_order', { ascending: true, nullsLast: true }),
      )

      delete inFlightBySectionRef.current[sectionId]
      if (userIdRef.current !== userId) return

      if (error) {
        markSectionPagesError(sectionId, error.message)
        return
      }

      seedSectionPages(sectionId, data ?? [])
    },
    [markSectionPagesError, markSectionPagesLoading, seedSectionPages, userId],
  )

  const upsertCachedPage = useCallback((sectionId, page) => {
    if (!sectionId || !page) return
    setSectionPageCache((prev) => upsertSectionPage(prev, sectionId, page))
  }, [])

  const updateCachedPage = useCallback((sectionId, pageId, changes) => {
    if (!sectionId || !pageId) return
    setSectionPageCache((prev) => updateSectionPage(prev, sectionId, pageId, changes))
  }, [])

  const removeCachedPage = useCallback((sectionId, pageId) => {
    if (!sectionId || !pageId) return
    setSectionPageCache((prev) => removeSectionPage(prev, sectionId, pageId))
  }, [])

  const markCachedTrackerPage = useCallback((sectionId, pageId) => {
    if (!sectionId || !pageId) return
    setSectionPageCache((prev) => setSectionTrackerPage(prev, sectionId, pageId))
  }, [])

  return {
    sectionPageCache,
    loadSectionPagesMeta,
    seedSectionPages,
    upsertCachedPage,
    updateCachedPage,
    removeCachedPage,
    markCachedTrackerPage,
  }
}
