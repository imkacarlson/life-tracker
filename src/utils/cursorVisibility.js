/**
 * Computes how many pixels to scroll down to keep a cursor above a safe zone.
 *
 * Ported from Notesnook's keep-in-view extension pattern:
 * when the mobile toolbar expands it covers the bottom of the viewport, so
 * we add 60px to the threshold when the expanded toolbar is detected.
 *
 * @param {{ cursorBottom: number, safeBottom: number }} params
 *   cursorBottom — cursor's bottom edge in viewport coordinates (getBoundingClientRect or coordsAtPos)
 *   safeBottom   — y-coordinate of the safe zone's bottom edge (toolbar.top - padding)
 * @returns {number} pixels to scroll down; 0 if no scroll needed
 */
export function computeScrollDelta({ cursorBottom, safeBottom }) {
  if (cursorBottom <= safeBottom) return 0
  return cursorBottom - safeBottom
}
