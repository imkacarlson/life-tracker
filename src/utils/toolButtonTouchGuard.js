// Focus-preservation guard for toolbar buttons inside a contenteditable.
//
// Why this exists: tapping a <button> while a contenteditable has focus
// transfers focus to the button. That collapses the editor selection
// (so toggleBold/toggleItalic/... ends up a no-op) and on touch devices
// dismisses the on-screen keyboard.
//
// Mitigation: preventDefault on `mousedown` only. mousedown also fires on
// touch (via the touch→mouse compatibility sequence) before the synthetic
// click, so a single capture-phase mousedown handler blocks the focus
// transfer for both pointer and touch.
//
// Do NOT also preventDefault `touchstart`. On Android Chrome, canceling
// touchstart suppresses the synthetic click that would otherwise follow
// touchend, which silently breaks every tool button that activates via
// onClick (most visibly the toolbar expand/collapse toggle). We hit this
// regression once; this util is the single place that invariant lives.
//
// Matches the proven pattern in notesnook's tool-button (mousedown-only,
// no touchstart listener).

export function attachToolButtonTouchGuard(el, { isTouchOnly } = {}) {
  if (!el || !isTouchOnly) return () => {}
  const onDown = (e) => { e.preventDefault() }
  el.addEventListener('mousedown', onDown, { capture: true, passive: false })
  return () => {
    el.removeEventListener('mousedown', onDown, { capture: true })
  }
}
