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
 * The `align` param picks the strategy:
 *   'keep'   (default) → minimal scroll that brings the rect just inside the
 *                        safe band. Correct for typing/deep-links: don't move
 *                        the view unless the cursor would be hidden.
 *   'center'          → always position the rect's vertical center at the safe
 *                        band's center. Used by find navigation so each
 *                        Prev/Next lands the match in the middle of the view.
 *
 * @param {{ cursorTop: number, cursorBottom: number, safeTop: number, safeBottom: number, padding?: number, align?: 'keep' | 'center' }} params
 */
export function computeScrollAdjustment({
  cursorTop,
  cursorBottom,
  safeTop,
  safeBottom,
  padding = 0,
  align = 'keep',
}) {
  if (align === 'center') {
    const rectCenter = (cursorTop + cursorBottom) / 2
    const bandCenter = (safeTop + safeBottom) / 2
    return rectCenter - bandCenter
  }

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
    // Prefer the visual viewport so the surface shrinks to the keyboard's top
    // edge: vv.offsetTop/height are in the same client-coordinate space as
    // getBoundingClientRect() and coordsAtPos(), so caret, toolbar, and surface
    // rects all agree (offsetTop also accounts for pinch-zoom pan). A shrunken
    // surface keeps the bottom toolbar reliably in the lower half so the
    // getToolbarSafeBounds center heuristic can't flip and misclassify it.
    // Desktop / environments without visualViewport fall back to innerHeight.
    getRect: () => {
      const vv = typeof window !== 'undefined' ? window.visualViewport : null
      if (vv) return { top: vv.offsetTop, bottom: vv.offsetTop + vv.height }
      return { top: 0, bottom: window.innerHeight }
    },
  }
}

/**
 * Per-page scroll restoration needs to read and write a single scalar offset on
 * whichever surface actually scrolls — the `.editor-panel` container on desktop,
 * but the window on mobile (responsive.css overrides the panel to
 * `overflow-y: visible`). This mirrors `pickScrollSurface`'s detection but
 * exposes a simple get/set offset accessor plus the surface's scroll height so
 * the restoration hook can wait for layout to grow tall enough.
 *
 * @param {HTMLElement | null | undefined} container
 * @returns {{ get: () => number, set: (top: number) => void, getScrollHeight: () => number, target: EventTarget | null }}
 */
export function getEditorScrollSurface(container) {
  const isScrollContainer =
    container &&
    container.scrollHeight > container.clientHeight &&
    typeof window !== 'undefined' &&
    getComputedStyle(container).overflowY !== 'visible'

  if (isScrollContainer) {
    return {
      get: () => container.scrollTop,
      set: (top) => {
        container.scrollTop = top
      },
      getScrollHeight: () => container.scrollHeight,
      target: container,
    }
  }

  return {
    get: () => (typeof window !== 'undefined' ? window.scrollY : 0),
    set: (top) => {
      if (typeof window !== 'undefined') window.scrollTo(0, top)
    },
    getScrollHeight: () =>
      typeof document !== 'undefined' ? document.documentElement.scrollHeight : 0,
    target: typeof window !== 'undefined' ? window : null,
  }
}

/**
 * Decide how a toolbar (or any fixed/sticky chrome) shrinks the safe band of a
 * scroll surface. The toolbar can live at the *top* of the surface (desktop:
 * `position: sticky; top: 0`) or at the *bottom* (mobile: `position: fixed;
 * bottom: 0`). We compare the toolbar's center to the surface's center to figure
 * out which edge it obstructs, then pull that edge inward.
 *
 * - Top obstruction    → raise safeTop to the toolbar's bottom edge.
 * - Bottom obstruction → lower safeBottom to the toolbar's top edge.
 *
 * A toolbar that is missing, has zero height, or sits entirely outside the
 * surface is ignored (safe band unchanged).
 *
 * @param {{ surfaceTop: number, surfaceBottom: number, toolbarEl: HTMLElement | null, padding?: number }} params
 * @returns {{ safeTop: number, safeBottom: number }}
 */
export function getToolbarSafeBounds({ surfaceTop, surfaceBottom, toolbarEl }) {
  let safeTop = surfaceTop
  let safeBottom = surfaceBottom
  if (!toolbarEl) return { safeTop, safeBottom }

  const toolbarRect = toolbarEl.getBoundingClientRect()
  if (toolbarRect.height <= 0) return { safeTop, safeBottom }
  // Toolbar entirely above or below the surface → it obstructs nothing.
  if (toolbarRect.bottom <= surfaceTop) return { safeTop, safeBottom }
  if (toolbarRect.top >= surfaceBottom) return { safeTop, safeBottom }

  const surfaceCenter = (surfaceTop + surfaceBottom) / 2
  const toolbarCenter = (toolbarRect.top + toolbarRect.bottom) / 2

  if (toolbarCenter < surfaceCenter) {
    // Toolbar is in the upper half → it covers the top of the surface.
    safeTop = Math.min(surfaceBottom, Math.max(surfaceTop, toolbarRect.bottom))
  } else {
    // Toolbar is in the lower half → it covers the bottom of the surface.
    safeBottom = Math.max(surfaceTop, Math.min(surfaceBottom, toolbarRect.top))
  }
  return { safeTop, safeBottom }
}

export function scrollRectIntoViewWithToolbar({
  rect,
  container = null,
  toolbarEl = null,
  padding = 16,
  align = 'keep',
}) {
  if (!rect) return 0
  const surface = pickScrollSurface(container)
  const surfaceRect = surface.getRect()
  const { safeTop, safeBottom } = getToolbarSafeBounds({
    surfaceTop: surfaceRect.top,
    surfaceBottom: surfaceRect.bottom,
    toolbarEl,
  })
  const delta = computeScrollAdjustment({
    cursorTop: rect.top,
    cursorBottom: rect.bottom,
    safeTop,
    safeBottom,
    padding,
    align,
  })

  if (delta !== 0) surface.scrollBy({ top: delta })
  return delta
}

export function scrollElementIntoViewWithToolbar({
  element,
  container = null,
  toolbarEl = null,
  padding = 16,
  align = 'keep',
}) {
  if (!element) return 0
  return scrollRectIntoViewWithToolbar({
    rect: element.getBoundingClientRect(),
    container,
    toolbarEl,
    padding,
    align,
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
