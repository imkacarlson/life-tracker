/**
 * Tiny coordination point between the PWA update banner and the app's
 * unsaved-work guard.
 *
 * PwaUpdatePrompt is rendered as a *sibling* of App (see main.jsx) so it stays
 * alive even if App crashes into the error boundary. That means there is no
 * shared React tree to pass a callback through — this module is the seam.
 *
 * Two jobs:
 *   1. App registers a "we're about to reload on purpose" handler (flushing
 *      pending saves) that the banner can invoke before it reloads.
 *   2. The latch tells App's `beforeunload` handler that this unload is
 *      user-intended, so it must not turn it into a native "Leave site?"
 *      prompt — cancelling that prompt is exactly what leaves the update
 *      banner permanently dead.
 *
 * Framework-free and pure-ish on purpose so it can be unit-tested directly.
 */

let beforeReloadHandler = null
let intentional = false

/**
 * Register the callback to run immediately before an intentional reload.
 * Only one handler is held at a time (there is only one App).
 *
 * @param {() => void} fn
 * @returns {() => void} unsubscribe — safe to return straight from an effect.
 */
export function setBeforeReloadHandler(fn) {
  beforeReloadHandler = fn
  return () => {
    if (beforeReloadHandler === fn) beforeReloadHandler = null
  }
}

/**
 * Flush pending work, then latch "this unload is intentional".
 *
 * The latch is deliberately one-way: once the user has asked to reload, any
 * unload that follows is the one they asked for.
 */
export function beginIntentionalReload() {
  if (beforeReloadHandler) beforeReloadHandler()
  intentional = true
}

/** @returns {boolean} whether an intentional reload is in progress. */
export function isIntentionalReload() {
  return intentional
}

/** Test-only: clear module-level state between cases. */
export function __resetForTests() {
  beforeReloadHandler = null
  intentional = false
}
