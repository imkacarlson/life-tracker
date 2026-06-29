import { useCallback, useRef } from 'react'

// Bound each visit log so it can't grow without limit. Thirty is plenty to find
// a recently-visited survivor after a delete.
const MAX_HISTORY = 30

const createVisitLog = () => []

/**
 * A small in-memory, session-lifetime visited-history for notebooks/sections/
 * pages. Used to return the user to where they were after deleting the open
 * item (see pickPostDeleteTarget). Lives in a ref — it never needs to trigger a
 * re-render, and survives for the lifetime of the App component.
 */
export function useNavigationHistory() {
  const logsRef = useRef({
    pages: createVisitLog(),
    sections: createVisitLog(),
    notebooks: createVisitLog(),
  })

  // Push `id` as the most-recent visit for `kind`, removing any earlier
  // occurrence so the latest visit always wins, then bound the log length.
  const recordVisit = useCallback((kind, id) => {
    if (!id) return
    const log = logsRef.current[kind]
    if (!log) return
    const filtered = log.filter((entry) => entry !== id)
    filtered.push(id)
    logsRef.current[kind] = filtered.slice(-MAX_HISTORY)
  }, [])

  // Most-recent visited id (for `kind`) that is still present in `existingIds`
  // and not the excluded id. Returns null when there's no surviving match.
  const getRecentExisting = useCallback((kind, existingIds, excludeId = null) => {
    const log = logsRef.current[kind]
    if (!log) return null
    const existing = existingIds instanceof Set ? existingIds : new Set(existingIds)
    for (let i = log.length - 1; i >= 0; i -= 1) {
      const id = log[i]
      if (id === excludeId) continue
      if (existing.has(id)) return id
    }
    return null
  }, [])

  return { recordVisit, getRecentExisting }
}
