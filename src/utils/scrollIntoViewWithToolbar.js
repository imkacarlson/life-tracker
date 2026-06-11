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

export function getToolbarSafeBottom({ surfaceBottom, toolbarEl, padding = 0 }) {
  if (!toolbarEl) return surfaceBottom
  const toolbarRect = toolbarEl.getBoundingClientRect()
  if (toolbarRect.height <= 0) return surfaceBottom
  if (toolbarRect.bottom <= padding) return surfaceBottom
  if (toolbarRect.top >= surfaceBottom) return surfaceBottom
  return Math.max(padding, Math.min(surfaceBottom, toolbarRect.top))
}

export function scrollRectIntoViewWithToolbar({
  rect,
  container = null,
  toolbarEl = null,
  padding = 16,
}) {
  if (!rect) return 0
  const surface = pickScrollSurface(container)
  const surfaceRect = surface.getRect()
  const safeBottom = getToolbarSafeBottom({
    surfaceBottom: surfaceRect.bottom,
    toolbarEl,
    padding,
  })
  const delta = computeScrollAdjustment({
    cursorTop: rect.top,
    cursorBottom: rect.bottom,
    safeTop: surfaceRect.top,
    safeBottom,
    padding,
  })

  if (delta !== 0) surface.scrollBy({ top: delta })
  return delta
}

export function scrollElementIntoViewWithToolbar({
  element,
  container = null,
  toolbarEl = null,
  padding = 16,
}) {
  if (!element) return 0
  return scrollRectIntoViewWithToolbar({
    rect: element.getBoundingClientRect(),
    container,
    toolbarEl,
    padding,
  })
}

export function scrollSelectionIntoViewWithToolbar({
  view,
  container = null,
  toolbarEl = null,
  padding = 16,
}) {
  if (!view?.state?.selection || !view.coordsAtPos) return 0
  const resolvedContainer = container ?? view.dom?.closest?.('.editor-panel') ?? null
  const resolvedToolbar =
    toolbarEl ??
    resolvedContainer?.querySelector?.('.toolbar') ??
    (typeof document !== 'undefined' ? document.querySelector('.toolbar') : null)
  const coords = view.coordsAtPos(view.state.selection.head)
  return scrollRectIntoViewWithToolbar({
    rect: coords,
    container: resolvedContainer,
    toolbarEl: resolvedToolbar,
    padding,
  })
}
