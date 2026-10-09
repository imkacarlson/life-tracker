/**
 * Detect whether a local draft conflicts with a newer server version.
 *
 * Returns a conflict descriptor object if the server's updated_at is newer
 * than the draft's timestamp, or null if there is no conflict.
 *
 * Extracted from the usePages useEffect so it can be unit-tested without
 * React or Supabase.
 */
export const draftMatchesServerContent = (serverRow, draft) =>
  Boolean(serverRow?.content && draft?.content) &&
  JSON.stringify(serverRow.content) === JSON.stringify(draft.content)

export const detectConflict = (pageId, serverRow, draft) => {
  if (!pageId) return null
  if (!serverRow || !draft || !draft.ts || !draft.content) return null

  // Same content means the draft is stale (save succeeded but draft wasn't cleaned up).
  // Not a real conflict — the data is identical.
  if (draftMatchesServerContent(serverRow, draft)) return null

  const serverTime = new Date(serverRow.updated_at).getTime()
  if (isNaN(serverTime)) return null
  if (serverTime > draft.ts) {
    return {
      pageId,
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

/**
 * Decide whether a rejected save (the version check matched zero rows) is a
 * real conflict.
 *
 * Unlike detectConflict, timestamps don't matter here. The save was rejected
 * because another device wrote the page after we loaded it, and our local edit
 * is always "newer" by the clock — comparing times would wave the conflict
 * through and let the next save overwrite the other device's work. The only
 * safe "no conflict" answer is when the server already holds exactly what we
 * were trying to save.
 */
export const detectSaveConflict = (pageId, serverRow, local) => {
  if (!pageId || !serverRow || !local?.content) return null
  const sameTitle = (serverRow.title ?? null) === (local.title ?? null)
  if (sameTitle && draftMatchesServerContent(serverRow, local)) return null
  return {
    pageId,
    draftTs: local.ts,
    serverUpdatedAt: serverRow.updated_at,
    draftContent: local.content,
    draftTitle: local.title,
    serverContent: serverRow.content,
    serverTitle: serverRow.title,
  }
}
