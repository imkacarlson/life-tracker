// Pure decision + geometry helpers for the custom italic caret. Kept free of
// ProseMirror/DOM so the plugin glue stays thin and these stay unit-testable.

// Measured slant of Instrument Sans italic (canvas measurement = 13.1deg). The
// caret leans by the same angle so it reads as part of the italic text.
export const ITALIC_CARET_SKEW_DEG = 13

/**
 * Decide whether to draw the custom (slanted) caret in place of the native one.
 * True only for a focused, collapsed caret sitting in italic-active context.
 * A range selection (selectionEmpty === false) always yields false so the
 * native selection UI is never shadowed by a stray caret.
 *
 * Note: pointer type is intentionally NOT a gate — the feature runs on desktop
 * and touch alike (gating on `pointer: fine` would wrongly disable it on
 * mobile, where the caret was verified to position and slant correctly).
 *
 * @param {{ focused: boolean, selectionEmpty: boolean, italicActive: boolean }} params
 * @returns {boolean}
 */
export function shouldShowItalicCaret({ focused, selectionEmpty, italicActive }) {
  return Boolean(focused) && Boolean(selectionEmpty) && Boolean(italicActive)
}

/**
 * Build the inline style values for the caret element from a ProseMirror
 * `coordsAtPos` rect. `coordsAtPos` returns a solid non-zero rect for every
 * block type (empty paragraph, table cell, heading, body), unlike collapsed DOM
 * ranges which report zero height on empty lines.
 *
 * Coordinates are viewport-relative, matching `position: fixed`.
 *
 * @param {{ left: number, top: number, bottom: number }} rect
 * @returns {{ left: number, top: number, height: number, transform: string }}
 */
export function caretStyleFromRect(rect) {
  const height = rect.bottom - rect.top
  return {
    left: rect.left,
    top: rect.top,
    height,
    transform: `skewX(-${ITALIC_CARET_SKEW_DEG}deg)`,
  }
}
