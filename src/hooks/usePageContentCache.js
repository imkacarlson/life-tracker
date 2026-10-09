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
// How many past version tokens to remember per page for hasSeenVersion.
const MAX_SEEN_VERSIONS = 50

/**
 * Per-page content cache using the Notesnook lazy-fetch-on-activation pattern.
 * The sidebar tree carries metadata only; full page content is fetched on
 * first activation and written-through after each successful autosave.
 *
 * Shape: { [pageId]: { status, content, error, loadedAt } }
 *
 * Returns:
 *   pageContentCache         — reactive cache map (React state)
 *   loadPageContent(id)      — idempotent single-row content fetch that resolves content
 *   setPageContent(id, c, ts)— write-through after autosave (ts advances the OCC token)
 *   invalidatePage(id)       — resets to IDLE (for conflict resolution)
 *   getKnownUpdatedAt(id)    — current OCC version token from server
 *   setKnownUpdatedAt(id, ts)— record the latest server timestamp we've observed
 *   hasSeenVersion(id, ts)   — true if this device already held that version
 *                              (our own saves, loads, adopted remote versions)
 */
export function usePageContentCache(userId) {
  const [pageContentCache, setPageContentCache] = useState({})
  const cacheRef = useRef(pageContentCache)
  const inFlightRef = useRef({})
  const userIdRef = useRef(userId)
  // LRU order: oldest pageId at index 0, newest at the end
  const lruOrderRef = useRef([])
  // OCC version tokens: { [pageId]: '2026-05-10T12:34:56.789Z' }
  // Populated from each successful load and each successful save.
  const knownUpdatedAtRef = useRef({})
  // Every version token this device has held per page: { [pageId]: string[] }.
  // Lets realtime ignore late echoes of our own earlier saves, which would
  // otherwise look like a remote edit and roll the editor back.
  const seenVersionsRef = useRef({})

  useEffect(() => {
    cacheRef.current = pageContentCache
  }, [pageContentCache])

  useEffect(() => {
    userIdRef.current = userId
    if (userId) return
    inFlightRef.current = {}
    lruOrderRef.current = []
    knownUpdatedAtRef.current = {}
    seenVersionsRef.current = {}
    setPageContentCache({})
  }, [userId])

  // Single place that moves the OCC token, so every version we hold is remembered.
  const rememberVersion = useCallback((pageId, updatedAt) => {
    knownUpdatedAtRef.current[pageId] = updatedAt
    const seen = seenVersionsRef.current[pageId] ?? []
    if (!seen.includes(updatedAt)) {
      seenVersionsRef.current[pageId] = [...seen, updatedAt].slice(-MAX_SEEN_VERSIONS)
    }
  }, [])

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
      if (!userId || !pageId) return null
      const current = cacheRef.current[pageId]
      if (current?.status === PAGE_CONTENT_STATUS.LOADING && inFlightRef.current[pageId]) {
        return inFlightRef.current[pageId]
      }
      if (current?.status === PAGE_CONTENT_STATUS.LOADED) return current.content ?? null
      if (inFlightRef.current[pageId]) return inFlightRef.current[pageId]

      const request = (async () => {
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

        if (userIdRef.current !== userId) return null

        if (error) {
          setPageContentCache((prev) => ({
            ...prev,
            [pageId]: { status: PAGE_CONTENT_STATUS.ERROR, content: null, error: error.message, loadedAt: null },
          }))
          throw new Error(error.message)
        }

        const content = data?.content ?? null
        if (data?.updated_at) {
          rememberVersion(pageId, data.updated_at)
        }
        recordAccess(pageId)
        setPageContentCache((prev) =>
          applyEviction({
            ...prev,
            [pageId]: {
              status: PAGE_CONTENT_STATUS.LOADED,
              content,
              error: null,
              loadedAt: Date.now(),
            },
          }),
        )
        return content
      })()

      inFlightRef.current[pageId] = request
      try {
        return await request
      } finally {
        if (inFlightRef.current[pageId] === request) {
          delete inFlightRef.current[pageId]
        }
      }
    },
    [userId, recordAccess, applyEviction, rememberVersion],
  )

  const setPageContent = useCallback(
    (pageId, content, updatedAt) => {
      if (!pageId) return
      if (updatedAt) {
        rememberVersion(pageId, updatedAt)
      }
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
    [recordAccess, applyEviction, rememberVersion],
  )

  const invalidatePage = useCallback((pageId) => {
    if (!pageId) return
    delete inFlightRef.current[pageId]
    delete knownUpdatedAtRef.current[pageId]
    delete seenVersionsRef.current[pageId]
    lruOrderRef.current = lruOrderRef.current.filter((id) => id !== pageId)
    setPageContentCache((prev) => {
      const next = { ...prev }
      delete next[pageId]
      return next
    })
  }, [])

  const getKnownUpdatedAt = useCallback((pageId) => {
    if (!pageId) return null
    return knownUpdatedAtRef.current[pageId] ?? null
  }, [])

  const setKnownUpdatedAt = useCallback(
    (pageId, updatedAt) => {
      if (!pageId || !updatedAt) return
      rememberVersion(pageId, updatedAt)
    },
    [rememberVersion],
  )

  const hasSeenVersion = useCallback((pageId, updatedAt) => {
    if (!pageId || !updatedAt) return false
    return (seenVersionsRef.current[pageId] ?? []).includes(updatedAt)
  }, [])

  return {
    pageContentCache,
    loadPageContent,
    setPageContent,
    invalidatePage,
    getKnownUpdatedAt,
    setKnownUpdatedAt,
    hasSeenVersion,
  }
}
