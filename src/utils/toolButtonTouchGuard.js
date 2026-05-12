// Focus-preservation guard for toolbar buttons inside a contenteditable.
//
// Why this exists: tapping a <button> while a contenteditable has focus
// transfers focus to the button. That collapses the editor selection
// (so toggleBold/toggleItalic/... ends up a no-op) and on touch devices
// dismisses the on-screen keyboard.
//
// Mitigation: preventDefault on `mousedown` only — and only when the
// on-screen keyboard is currently visible. mousedown also fires on touch
// (via the touch→mouse compatibility sequence) before the synthetic click,
// so a single capture-phase mousedown handler covers both pointer and touch.
//
// Do NOT also preventDefault `touchstart`. On Android Chrome, canceling
// touchstart suppresses the synthetic click that would otherwise follow
// touchend, which silently breaks every tool button that activates via
// onClick (most visibly the toolbar expand/collapse toggle).
//
// Why gate on the keyboard being shown: if the keyboard is *not* up, the
// editor isn't currently being typed into — preserving its focus on tap
// keeps Android Chrome in a state where the next tap inside the document
// re-opens the IME. Tapping the expand/collapse toggle then feels like it
// summons the keyboard out of nowhere. Notesnook's tool-button.tsx does the
// same gate (`if (globalThis.keyboardShown) e.preventDefault()`); see
// `src/utils/keyboardShown.js` for the web-side detector.

import { isKeyboardShown } from './keyboardShown'

export function attachToolButtonTouchGuard(el, { isTouchOnly } = {}) {
  if (!el || !isTouchOnly) return () => {}
  const onDown = (e) => {
    if (isKeyboardShown()) e.preventDefault()
  }
  el.addEventListener('mousedown', onDown, { capture: true, passive: false })
  return () => {
    el.removeEventListener('mousedown', onDown, { capture: true })
  }
}
