// Pure helpers for sidebar drag-and-drop reordering.
//
// The sidebar is a three-level tree (notebooks → sections → pages). Each
// draggable row carries `data: { type, parentId }`. We only allow a reorder
// when both the dragged row and the drop target share the same `type` AND the
// same `parentId` — that enforces "reorder within the same parent only" and
// makes cross-group drops snap back harmlessly.

/**
 * True only when two dnd-kit data payloads describe siblings in the same group:
 * same node type (notebook/section/page) and same parent id.
 *
 * @param {{ type?: string, parentId?: string|null }} [activeData]
 * @param {{ type?: string, parentId?: string|null }} [overData]
 * @returns {boolean}
 */
export function canReorder(activeData, overData) {
  if (!activeData || !overData) return false
  if (!activeData.type || activeData.type !== overData.type) return false
  // parentId may be null (notebooks have no parent) — compare directly so two
  // nulls match but a null never matches a real id.
  return activeData.parentId === overData.parentId
}

/**
 * Returns a new array with the item identified by `activeId` moved to the
 * position of `overId`. If either id is missing from the list, the original
 * array is returned unchanged.
 *
 * @template {{ id: string }} T
 * @param {T[]} items
 * @param {string} activeId
 * @param {string} overId
 * @returns {T[]}
 */
export function reorderById(items, activeId, overId) {
  if (!Array.isArray(items)) return items
  const fromIndex = items.findIndex((item) => item.id === activeId)
  const toIndex = items.findIndex((item) => item.id === overId)
  if (fromIndex === -1 || toIndex === -1) return items
  if (fromIndex === toIndex) return items
  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

/**
 * Returns a new array where each item's `sort_order` is set to its index + 1.
 * Mirrors the integer-reindex approach used by reorderTrackers.
 *
 * @template {object} T
 * @param {T[]} items
 * @returns {T[]}
 */
export function reindexSortOrder(items) {
  if (!Array.isArray(items)) return items
  return items.map((item, index) => ({ ...item, sort_order: index + 1 }))
}

/**
 * Returns a new array with `created` inserted immediately after the page whose
 * id matches `activeId`. If `activeId` is null/undefined or not found in
 * `pages`, the created page is appended at the end (matching the legacy
 * "+ New page" behavior). Does not mutate the input.
 *
 * @template {{ id: string }} T
 * @param {T[]} pages
 * @param {T} created
 * @param {string|null} [activeId]
 * @returns {T[]}
 */
export function insertPageAfter(pages, created, activeId) {
  const base = Array.isArray(pages) ? pages : []
  const activeIndex = activeId ? base.findIndex((page) => page.id === activeId) : -1
  if (activeIndex === -1) {
    return [...base, created]
  }
  const next = [...base]
  next.splice(activeIndex + 1, 0, created)
  return next
}
