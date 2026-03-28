/**
 * Detect whether a local draft conflicts with a newer server version.
 *
 * Returns a conflict descriptor object if the server's updated_at is newer
 * than the draft's timestamp, or null if there is no conflict.
 *
 * Extracted from the useTrackers useEffect so it can be unit-tested without
 * React or Supabase.
 */
export const detectConflict = (trackerId, serverRow, draft) => {
  if (!trackerId) return null
  if (!serverRow || !draft || !draft.ts || !draft.content) return null

  // Same content means the draft is stale (save succeeded but draft wasn't cleaned up).
  // Not a real conflict — the data is identical.
  if (JSON.stringify(serverRow.content) === JSON.stringify(draft.content)) return null

  const serverTime = new Date(serverRow.updated_at).getTime()
  if (isNaN(serverTime)) return null
  if (serverTime > draft.ts) {
    return {
      trackerId,
      draftTs: draft.ts,
      serverUpdatedAt: serverRow.updated_at,
      draftContent: draft.content,
      draftTitle: draft.title,
      serverContent: serverRow.content,
      serverTitle: serverRow.title,
    }
  }
  return null
}
