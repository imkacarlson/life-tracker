/**
 * Bidirectional scroll math for keeping a cursor / element inside the visible
 * band between a top boundary and a bottom boundary such as a mobile toolbar's
 * top edge.
 *
 * Ported from Notesnook's keep-in-view extension
 * (packages/editor/src/extensions/keep-in-view/keep-in-view.ts):
 * threshold check from both edges, single scrollBy with the signed delta.
 *
 * Positive return → scrollBy down (cursor is below the safe zone).
 * Negative return → scrollBy up   (cursor is above the safe zone, hidden by toolbar).
 * Zero return     → cursor is already inside the safe zone.
 *
 * @param {{ cursorTop: number, cursorBottom: number, safeTop: number, safeBottom: number, padding?: number }} params
 */
export function computeScrollAdjustment({
  cursorTop,
  cursorBottom,
  safeTop,
  safeBottom,
  padding = 0,
}) {
  const topEdge = safeTop + padding
  const bottomEdge = safeBottom - padding

  if (cursorTop < topEdge) {
    return cursorTop - topEdge
  }
  if (cursorBottom > bottomEdge) {
    return cursorBottom - bottomEdge
  }
  return 0
}

/**
 * Pick the appropriate scroll surface for a given element/container pair.
 * Mirrors the find-bar logic in Toolbar.jsx — prefer the editor panel when it
 * is an actual scroll container, otherwise fall back to the window.
 *
 * @param {HTMLElement | null | undefined} container
 * @returns {{ scrollBy: (opts: { top: number }) => void, getRect: () => { top: number, bottom: number } }}
 */
export function pickScrollSurface(container) {
  const isScrollContainer =
    container &&
    container.scrollHeight > container.clientHeight &&
    typeof window !== 'undefined' &&
    getComputedStyle(container).overflowY !== 'visible'

  if (isScrollContainer) {
    return {
      scrollBy: ({ top }) => container.scrollBy({ top, behavior: 'instant' }),
      getRect: () => {
        const rect = container.getBoundingClientRect()
        return { top: rect.top, bottom: rect.bottom }
      },
    }
  }
  return {
    scrollBy: ({ top }) => window.scrollBy({ top, behavior: 'instant' }),
    getRect: () => ({ top: 0, bottom: window.innerHeight }),
  }
}
