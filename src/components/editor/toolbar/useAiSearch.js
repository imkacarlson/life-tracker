import { useCallback, useEffect, useRef } from 'react'
import { supabase } from '../../../lib/supabase'
import { useEditorUIStore } from '../../../stores/editorUIStore'
import {
  extractSearchableBlocks,
  resolveBlockRanges,
  buildSearchCacheKey,
} from '../../../utils/aiSearchHelpers'

const DEBOUNCE_MS = 600
const MIN_QUERY_LENGTH = 3
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'

/**
 * Owns the latency/cost control for AI find:
 *  - debounces after typing stops (the literal highlight already gives instant
 *    feedback, wired separately in the toolbar)
 *  - requires a minimum query length
 *  - caches results per (docVersion, query) so re-typing is instant + free
 *  - cancels stale requests via a monotonic token so out-of-order responses
 *    never apply
 *  - validates returned ids against the sent set before highlighting
 *
 * Resolves matching block ids into whole-block ranges and feeds them to the
 * findInDoc plugin via `setAiMatches`, reusing all downstream UI.
 */
export function useAiSearch({ editor }) {
  const setAiSearchLoading = useEditorUIStore((s) => s.setAiSearchLoading)

  const debounceRef = useRef(null)
  const tokenRef = useRef(0)
  const cacheRef = useRef(new Map())
  const docVersionRef = useRef(0)

  // Bump a doc version on every content change so the cache invalidates when
  // the document is edited (buildSearchCacheKey folds it into the key).
  useEffect(() => {
    if (!editor) return undefined
    const onUpdate = () => {
      docVersionRef.current += 1
    }
    editor.on('update', onUpdate)
    return () => editor.off('update', onUpdate)
  }, [editor])

  const applyMatchIds = useCallback(
    (ids) => {
      if (!editor) return
      const ranges = resolveBlockRanges(editor.state.doc, new Set(ids))
      editor.commands.setAiMatches(ranges)
    },
    [editor],
  )

  const performSearch = useCallback(
    async (query) => {
      if (!editor) return

      const cacheKey = buildSearchCacheKey(docVersionRef.current, query)
      const cached = cacheRef.current.get(cacheKey)
      if (cached) {
        applyMatchIds(cached)
        return
      }

      const blocks = extractSearchableBlocks(editor.getJSON())
      if (!blocks.length) {
        applyMatchIds([])
        return
      }

      const myToken = (tokenRef.current += 1)
      setAiSearchLoading(true)
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (!session) throw new Error('You must be logged in to use AI Find')

        const provider = localStorage.getItem('ai-provider') || 'anthropic'
        const model = localStorage.getItem('ai-find-model') || DEFAULT_MODEL

        const { data, error } = await supabase.functions.invoke('ai-find', {
          body: { query, blocks, provider, model },
          headers: { Authorization: `Bearer ${session.access_token}` },
        })

        // Stale response — a newer search superseded this one.
        if (myToken !== tokenRef.current) return
        if (error) throw error
        if (data?.success === false) throw new Error(data?.error || 'AI Find failed')

        const matchIds = Array.isArray(data?.data?.matchIds) ? data.data.matchIds : []
        // Client-side validation: drop any id we didn't send (hallucinations).
        const sentIds = new Set(blocks.map((b) => b.id))
        const validIds = matchIds.map(String).filter((id) => sentIds.has(id))

        cacheRef.current.set(cacheKey, validIds)
        applyMatchIds(validIds)
      } catch (err) {
        if (myToken === tokenRef.current) {
          console.error('AI Find error:', err)
        }
      } finally {
        if (myToken === tokenRef.current) setAiSearchLoading(false)
      }
    },
    [editor, applyMatchIds, setAiSearchLoading],
  )

  // Debounced entry point — call on every query change while AI mode is on.
  const scheduleAiSearch = useCallback(
    (value) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      const query = String(value || '').trim()
      if (query.length < MIN_QUERY_LENGTH) {
        // Too short to search; the literal highlight (wired separately) stands.
        setAiSearchLoading(false)
        return
      }
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null
        performSearch(query)
      }, DEBOUNCE_MS)
    },
    [performSearch, setAiSearchLoading],
  )

  // Cancel any pending debounce and invalidate any in-flight request.
  const cancelAiSearch = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    tokenRef.current += 1 // invalidate in-flight responses
    setAiSearchLoading(false)
  }, [setAiSearchLoading])

  useEffect(() => () => cancelAiSearch(), [cancelAiSearch])

  return { scheduleAiSearch, cancelAiSearch }
}
