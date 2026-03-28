// Pure helper functions for pinch-to-zoom gesture math.
// Used by useContentZoom hook — extracted here for testability.

const MIN_ZOOM = 0.5
const MAX_ZOOM = 2.0

/**
 * Calculate the distance between two touch points.
 */
export function pinchDistance(touch1, touch2) {
  const dx = touch1.clientX - touch2.clientX
  const dy = touch1.clientY - touch2.clientY
  return Math.hypot(dx, dy)
}

/**
 * Calculate the midpoint between two touch points.
 * Returns { x, y } in viewport (client) coordinates.
 */
export function pinchMidpoint(touch1, touch2) {
  return {
    x: (touch1.clientX + touch2.clientX) / 2,
    y: (touch1.clientY + touch2.clientY) / 2,
  }
}

/**
 * Clamp a zoom level to the allowed range.
 */
export function clampZoom(zoom) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/**
 * Calculate the new scroll position to keep the pinch midpoint
 * visually fixed after a zoom change.
 *
 * @param {number} scrollY - current window.scrollY
 * @param {number} midY - pinch midpoint Y in viewport coords
 * @param {number} oldZoom - zoom level before this step
 * @param {number} newZoom - zoom level after this step
 * @returns {number} new scrollY value
 */
export function anchoredScrollY(scrollY, midY, oldZoom, newZoom) {
  return ((scrollY + midY) / oldZoom) * newZoom - midY
}

/**
 * Same as anchoredScrollY but for the X axis.
 */
export function anchoredScrollX(scrollX, midX, oldZoom, newZoom) {
  return ((scrollX + midX) / oldZoom) * newZoom - midX
}

export { MIN_ZOOM, MAX_ZOOM }
