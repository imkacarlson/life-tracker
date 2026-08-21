import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { runSupabaseQueryWithRetry } from '../utils/supabaseRetry'
import {
  MAX_SUGGESTION_SLOTS,
  buildSuggestionSlots,
  toClientSuggestion,
} from '../utils/librarySuggestions'

const NO_SUGGESTIONS = []

/** One live set is identified by the page it belongs to: which level, and (for
 *  topics) which section. */
const setKey = (scope, sectionId) => `${scope ?? ''}:${sectionId ?? ''}`

/**
 * The last answer per key, and the request currently getting it — both
 * module-scoped, because the thing they are protecting against is remounting.
 *
 * EditorPanel is keyed by the editor session id and remounts several times
 * while a page settles. Per-hook state cannot help with that: each mount starts
 * empty, so the block fetched five times per page view and blinked from "make
 * your own" to two cards on every one of them. Sharing the in-flight request
 * collapses those into one, and keeping the answer for a few seconds means a
 * remount renders the cards it already had.
 *
 * Same shape as useSectionPageCache's inFlightBySectionRef, one level up. Rows
 * only change when the server writes them or the user spends one, and both of
 * those update the cache, so there is nothing here a reload would not fix.
 */
const lastAnswer = new Map()
const inFlight = new Map()
const REUSE_MS = 5000

async function fetchSet(userId, scope, sectionId) {
  const cacheKey = setKey(scope, sectionId)
  const pending = inFlight.get(cacheKey)
  if (pending) return pending

  const request = (async () => {
    let query = supabase
      .from('library_suggestions')
      .select('id, scope, section_id, title, why, evidence_page_ids, generated_at')
      .eq('user_id', userId)
      .eq('scope', scope)
      // The live set: dismissed and accepted rows stay in the table as the
      // memory of what not to propose again, but they are spent.
      .is('dismissed_at', null)
      .is('accepted_at', null)
      .order('generated_at', { ascending: false })
      .limit(MAX_SUGGESTION_SLOTS)
    // A Library-wide suggestion has no section, which is a different query from
    // "any section" — PostgREST needs .is() for null.
    query = sectionId ? query.eq('section_id', sectionId) : query.is('section_id', null)

    const { data, error } = await runSupabaseQueryWithRetry(() => query)
    // A failed read means no block, not an error message. Nothing here is
    // load-bearing enough to interrupt someone reading a page.
    const items = error ? NO_SUGGESTIONS : (data ?? []).map(toClientSuggestion)
    lastAnswer.set(cacheKey, { items, at: Date.now() })
    return items
  })().finally(() => inFlight.delete(cacheKey))

  inFlight.set(cacheKey, request)
  return request
}

/**
 * The live suggestion set for one page, and the two ways to spend one.
 *
 * READS ROWS, NEVER CALLS A MODEL. The noticing pass runs on the server
 * (_shared/librarySuggest.ts) and writes library_suggestions; this is the render
 * half of the same store-then-render split library_topic_members uses.
 *
 * The slot maths lives in utils/librarySuggestions.js so it can be unit-tested
 * without a DOM — the house rule about extracting logic out of hooks.
 */
export function useLibrarySuggestions({ userId, scope, sectionId = null }) {
  // The key rides WITH the rows rather than beside them. Walking from one
  // section's front page to another's would otherwise show the first section's
  // cards until the second fetch landed, which is a suggestion appearing on a
  // page it was not about.
  const [loaded, setLoaded] = useState(() => {
    const key = setKey(scope, sectionId)
    const cached = lastAnswer.get(key)
    return cached ? { key, items: cached.items } : { key: null, items: NO_SUGGESTIONS }
  })
  // Guards a late response from a previous page overwriting the current one.
  const requestRef = useRef(0)

  const key = setKey(scope, sectionId)
  const suggestions = loaded.key === key ? loaded.items : NO_SUGGESTIONS

  const load = useCallback(
    async ({ force = false } = {}) => {
      if (!userId || !scope) return
      const cacheKey = setKey(scope, sectionId)
      const cached = lastAnswer.get(cacheKey)
      if (!force && cached && Date.now() - cached.at < REUSE_MS) {
        setLoaded({ key: cacheKey, items: cached.items })
        return
      }

      const request = requestRef.current + 1
      requestRef.current = request
      const items = await fetchSet(userId, scope, sectionId)
      if (requestRef.current !== request) return
      setLoaded({ key: cacheKey, items })
    },
    [scope, sectionId, userId],
  )

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- every state write in load() happens after an await, not synchronously
    void load()
  }, [load])

  /**
   * Spend a suggestion: it leaves the block and does not come back.
   *
   * Optimistic, and deliberately not rolled back on failure. The row is only a
   * suggestion — if the stamp fails the card returns on the next load, which is
   * a smaller surprise than a card reappearing under the user's cursor.
   */
  const resolve = useCallback(async (id, column) => {
    if (!id) return
    setLoaded((previous) => {
      const items = previous.items.filter((item) => item.id !== id)
      // The cache is what a remount reads from, so a spent card has to leave it
      // too — otherwise it comes back the moment the editor re-keys.
      if (previous.key) lastAnswer.set(previous.key, { items, at: Date.now() })
      return { ...previous, items }
    })
    const { error } = await supabase
      .from('library_suggestions')
      .update({ [column]: new Date().toISOString() })
      .eq('id', id)
    if (error) console.error(`library suggestion ${column} failed:`, error.message)
  }, [])

  // "Not interested". Fed back into the next prompt as already-rejected, which
  // is what stops the same card returning every week and becoming a chore.
  const dismiss = useCallback((id) => resolve(id, 'dismissed_at'), [resolve])
  // "Make it a topic" — kept apart from a rejection, because only a real
  // rejection may teach the prompt to stop proposing something.
  const markAccepted = useCallback((id) => resolve(id, 'accepted_at'), [resolve])

  const reload = useCallback(() => load({ force: true }), [load])

  return {
    suggestions,
    slots: buildSuggestionSlots(suggestions),
    dismiss,
    markAccepted,
    reload,
  }
}
