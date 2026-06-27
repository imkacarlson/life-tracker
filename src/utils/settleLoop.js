/**
 * Bounded animation-frame loop with a refreshable deadline.
 *
 * Used to re-assert a correction (e.g. keeping the caret above the keyboard)
 * every frame for a short settle window after a triggering event, so a late
 * native browser scroll that fires *after* our first correction still gets
 * overridden on the next frame.
 *
 * The loop runs `onTick` every animation frame until `now()` passes the
 * deadline (`start + durationMs`). Calling `refresh()` pushes the deadline out
 * by another `durationMs` from the current time — used when a new triggering
 * event (e.g. a second viewport resize) arrives mid-settle. `cancel()` stops it.
 *
 * All timing primitives are injected so the loop can be unit-tested with a fake
 * clock. Defaults wire up to the real browser globals.
 *
 * @param {{
 *   durationMs: number,
 *   onTick: () => void,
 *   now?: () => number,
 *   raf?: (cb: () => void) => number,
 *   caf?: (id: number) => void,
 * }} params
 * @returns {{ refresh: () => void, cancel: () => void }}
 */
export function createSettleLoop({
  durationMs,
  onTick,
  now = () => Date.now(),
  raf = (cb) => requestAnimationFrame(cb),
  caf = (id) => cancelAnimationFrame(id),
}) {
  let deadline = now() + durationMs
  let frameId = null
  let cancelled = false

  const tick = () => {
    frameId = null
    if (cancelled) return
    onTick()
    // Re-check after the tick: onTick may have taken time, and refresh() may
    // have extended the deadline. Stop once we're past it.
    if (now() >= deadline) return
    frameId = raf(tick)
  }

  frameId = raf(tick)

  return {
    refresh() {
      if (cancelled) return
      deadline = now() + durationMs
      // Restart the frame loop if it had already settled and stopped.
      if (frameId === null) {
        frameId = raf(tick)
      }
    },
    cancel() {
      cancelled = true
      if (frameId !== null) {
        caf(frameId)
        frameId = null
      }
    },
  }
}
