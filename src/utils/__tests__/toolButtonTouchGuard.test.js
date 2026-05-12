import { describe, it, expect, vi } from 'vitest'
import { attachToolButtonTouchGuard } from '../toolButtonTouchGuard'

// Focus-preservation guard for toolbar buttons.
//
// Why this exists: tapping a <button> while a contenteditable has focus
// transfers focus to the button. That collapses the editor selection
// (so toggleBold/Italic/... ends up a no-op) and on touch devices dismisses
// the on-screen keyboard.
//
// Mitigation: preventDefault on `mousedown` only. mousedown fires on touch
// too (via the touch→mouse compatibility sequence), so a single handler
// covers both mouse and touch.
//
// CRITICAL: we must NOT preventDefault `touchstart`. On Android Chrome,
// canceling touchstart suppresses the synthetic click that follows
// touchend, which silently breaks every tool button that activates via
// onClick — most notably the toolbar expand/collapse toggle.
// This util exists to make that invariant testable.

function makeEl() {
  // Node's EventTarget + Event are enough to verify addEventListener wiring.
  // No jsdom needed.
  return new EventTarget()
}

function dispatch(el, type, { cancelable = true } = {}) {
  const ev = new Event(type, { cancelable })
  el.dispatchEvent(ev)
  return ev
}

describe('attachToolButtonTouchGuard', () => {
  it('calls preventDefault on mousedown when isTouchOnly is true', () => {
    const el = makeEl()
    attachToolButtonTouchGuard(el, { isTouchOnly: true })
    const ev = dispatch(el, 'mousedown')
    expect(ev.defaultPrevented).toBe(true)
  })

  it('does NOT call preventDefault on touchstart (regression guard for Android click suppression)', () => {
    const el = makeEl()
    attachToolButtonTouchGuard(el, { isTouchOnly: true })
    const ev = dispatch(el, 'touchstart')
    expect(ev.defaultPrevented).toBe(false)
  })

  it('attaches no listeners when isTouchOnly is false', () => {
    const el = makeEl()
    attachToolButtonTouchGuard(el, { isTouchOnly: false })
    const md = dispatch(el, 'mousedown')
    const ts = dispatch(el, 'touchstart')
    expect(md.defaultPrevented).toBe(false)
    expect(ts.defaultPrevented).toBe(false)
  })

  it('returns a no-op cleanup when el is null', () => {
    const cleanup = attachToolButtonTouchGuard(null, { isTouchOnly: true })
    expect(typeof cleanup).toBe('function')
    expect(() => cleanup()).not.toThrow()
  })

  it('cleanup removes the mousedown listener', () => {
    const el = makeEl()
    const cleanup = attachToolButtonTouchGuard(el, { isTouchOnly: true })
    cleanup()
    const ev = dispatch(el, 'mousedown')
    expect(ev.defaultPrevented).toBe(false)
  })

  it('uses capture-phase listener (runs before bubble-phase listeners)', () => {
    const el = makeEl()
    const order = []
    // bubble-phase listener attached BEFORE the guard, but capture runs first
    el.addEventListener('mousedown', () => order.push('bubble'))
    attachToolButtonTouchGuard(el, { isTouchOnly: true })
    el.addEventListener('mousedown', (e) => {
      order.push(e.defaultPrevented ? 'bubble-after-guard:prevented' : 'bubble-after-guard:not-prevented')
    })
    dispatch(el, 'mousedown')
    // capture handler should have set defaultPrevented before bubble listeners run
    expect(order).toContain('bubble-after-guard:prevented')
  })
})
