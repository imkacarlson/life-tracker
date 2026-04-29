import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { runSupabaseQueryWithRetry } from '../utils/supabaseRetry'

export const PAGE_CONTENT_STATUS = {
  IDLE: 'idle',
  LOADING: 'loading',
  LOADED: 'loaded',
  ERROR: 'error',
}

const MAX_CACHE_ENTRIES = 30

/**
 * Per-page content cache using the Notesnook lazy-fetch-on-activation pattern.
 * The sidebar tree carries metadata only; full page content is fetched on
 * first activation and written-through after each successful autosave.
 *
 * Shape: { [pageId]: { status, content, error, loadedAt } }
 *
 * Returns:
 *   pageContentCache     — reactive cache map (React state)
 *   loadPageContent(id)  — idempotent single-row content fetch
 *   setPageContent(id, c)— write-through after autosave
 *   invalidatePage(id)   — resets to IDLE (for conflict resolution)
 */
export function usePageContentCache(userId) {
  const [pageContentCache, setPageContentCache] = useState({})
  const cacheRef = useRef(pageContentCache)
  const inFlightRef = useRef({})
  const userIdRef = useRef(userId)
  // LRU order: oldest pageId at index 0, newest at the end
  const lruOrderRef = useRef([])

  useEffect(() => {
    cacheRef.current = pageContentCache
  }, [pageContentCache])

  useEffect(() => {
    userIdRef.current = userId
    if (userId) return
    inFlightRef.current = {}
    lruOrderRef.current = []
    setPageContentCache({})
  }, [userId])

  const recordAccess = useCallback((pageId) => {
    const order = lruOrderRef.current.filter((id) => id !== pageId)
    order.push(pageId)
    lruOrderRef.current = order
  }, [])

  const applyEviction = useCallback((cache) => {
    const order = lruOrderRef.current
    if (order.length <= MAX_CACHE_ENTRIES) return cache
    const toEvict = order.slice(0, order.length - MAX_CACHE_ENTRIES)
    lruOrderRef.current = order.slice(order.length - MAX_CACHE_ENTRIES)
    const next = { ...cache }
    for (const id of toEvict) delete next[id]
    return next
  }, [])

  const loadPageContent = useCallback(
    async (pageId) => {
      if (!userId || !pageId) return
      const current = cacheRef.current[pageId]
      if (current?.status === PAGE_CONTENT_STATUS.LOADING) return
      if (current?.status === PAGE_CONTENT_STATUS.LOADED) return
      if (inFlightRef.current[pageId]) return

      inFlightRef.current[pageId] = true
      setPageContentCache((prev) => ({
        ...prev,
        [pageId]: {
          status: PAGE_CONTENT_STATUS.LOADING,
          content: prev[pageId]?.content ?? null,
          error: null,
          loadedAt: null,
        },
      }))

      const { data, error } = await runSupabaseQueryWithRetry(() =>
        supabase
          .from('pages')
          .select('content, updated_at')
          .eq('id', pageId)
          .single(),
      )

      delete inFlightRef.current[pageId]
      if (userIdRef.current !== userId) return

      if (error) {
        setPageContentCache((prev) => ({
          ...prev,
          [pageId]: { status: PAGE_CONTENT_STATUS.ERROR, content: null, error: error.message, loadedAt: null },
        }))
        return
      }

      recordAccess(pageId)
      setPageContentCache((prev) =>
        applyEviction({
          ...prev,
          [pageId]: {
            status: PAGE_CONTENT_STATUS.LOADED,
            content: data?.content ?? null,
            error: null,
            loadedAt: Date.now(),
          },
        }),
      )
    },
    [userId, recordAccess, applyEviction],
  )

  const setPageContent = useCallback(
    (pageId, content) => {
      if (!pageId) return
      recordAccess(pageId)
      setPageContentCache((prev) =>
        applyEviction({
          ...prev,
          [pageId]: {
            status: PAGE_CONTENT_STATUS.LOADED,
            content: content ?? null,
            error: null,
            loadedAt: Date.now(),
          },
        }),
      )
    },
    [recordAccess, applyEviction],
  )

  const invalidatePage = useCallback((pageId) => {
    if (!pageId) return
    delete inFlightRef.current[pageId]
    lruOrderRef.current = lruOrderRef.current.filter((id) => id !== pageId)
    setPageContentCache((prev) => {
      const next = { ...prev }
      delete next[pageId]
      return next
    })
  }, [])

  return {
    pageContentCache,
    loadPageContent,
    setPageContent,
    invalidatePage,
  }
}
