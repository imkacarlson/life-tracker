/**
 * Pick where to land after deleting the currently-open item (page, section, or
 * notebook). Mirrors the email-client convention used by Mail/Outlook and the
 * "pop to previous tab" behavior in Notesnook's editor store:
 *
 *   1. The most-recently-visited surviving sibling (so create→delete returns you
 *      to the page you were on before).
 *   2. Otherwise the sibling adjacent to the deleted item's old slot — prefer the
 *      next item, fall back to the previous (handles deleting an item reached
 *      directly via deep link, with no visit history).
 *   3. Otherwise the first remaining item.
 *   4. Otherwise null (nothing left to select).
 *
 * Never returns `deletedId` — `remainingItems` already excludes it.
 *
 * @param {object} params
 * @param {{ getRecentExisting: (kind: string, existingIds: string[], excludeId?: string|null) => string|null }|null} params.history
 * @param {'pages'|'sections'|'notebooks'} params.kind
 * @param {Array<{ id: string }>} params.remainingItems - items AFTER removing the deleted one, in display order
 * @param {string} params.deletedId
 * @param {number|null} [params.deletedIndex] - index of the deleted item in the ORIGINAL ordered list
 * @returns {string|null}
 */
export function pickPostDeleteTarget({
  history = null,
  kind,
  remainingItems = [],
  deletedId,
  deletedIndex = null,
}) {
  const existingIds = remainingItems.map((item) => item.id)

  // 1. Most-recent visited survivor.
  const recent = history?.getRecentExisting?.(kind, existingIds, deletedId) ?? null
  if (recent) return recent

  // 2. Sibling adjacent to the deleted item's old slot. After removal, the item
  //    that followed the deleted one now sits at `deletedIndex`; prefer it, else
  //    fall back to the item that preceded it.
  if (deletedIndex != null && remainingItems.length > 0) {
    const next = remainingItems[deletedIndex]
    if (next) return next.id
    const prev = remainingItems[deletedIndex - 1]
    if (prev) return prev.id
  }

  // 3 & 4. First remaining item, else nothing.
  return remainingItems[0]?.id ?? null
}
