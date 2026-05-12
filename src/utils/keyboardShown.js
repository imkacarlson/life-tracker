// Web equivalent of notesnook's `globalThis.keyboardShown` flag.
//
// Detects whether the mobile on-screen keyboard is currently displayed by
// watching window.visualViewport. When the keyboard is up, visualViewport.height
// drops well below document.documentElement.clientHeight; address-bar shrink
// and other chrome motion produce much smaller deltas, so we gate on a
// threshold.
//
// Consumers read isKeyboardShown() at the exact moment they need it (e.g. in
// the toolbar button's mousedown handler) — no subscription / re-render needed.
//
// Why a module singleton instead of a React hook: the toolbar re-renders on
// nearly every editor transaction; a hook here would mean hundreds of viewport
// listener attach/detach cycles. Notesnook uses globalThis.keyboardShown for
// the same reason.

const KEYBOARD_HEIGHT_THRESHOLD = 150

let installed = false
let cachedShown = false
let onChange = null

function getViewport() {
  return typeof globalThis !== 'undefined' ? globalThis.visualViewport : null
}

function getLayoutHeight() {
  const doc = typeof globalThis !== 'undefined' ? globalThis.document : null
  return doc?.documentElement?.clientHeight ?? 0
}

function computeShown() {
  const viewport = getViewport()
  if (!viewport) return false
  const layoutHeight = getLayoutHeight()
  if (!layoutHeight) return false
  return layoutHeight - viewport.height > KEYBOARD_HEIGHT_THRESHOLD
}

export function isKeyboardShown() {
  // Before install (or after uninstall) we conservatively report "not shown"
  // so consumers don't get a stale live read from a viewport we're no longer
  // tracking. Production wires installKeyboardShownTracker() at app boot.
  return installed ? cachedShown : false
}

export function installKeyboardShownTracker() {
  if (installed) return () => {}
  const viewport = getViewport()
  if (!viewport) return () => {}

  installed = true
  cachedShown = computeShown()

  onChange = () => {
    cachedShown = computeShown()
  }
  viewport.addEventListener('resize', onChange)
  viewport.addEventListener('scroll', onChange)

  return uninstallKeyboardShownTracker
}

export function uninstallKeyboardShownTracker() {
  if (!installed) return
  const viewport = getViewport()
  if (viewport && onChange) {
    viewport.removeEventListener('resize', onChange)
    viewport.removeEventListener('scroll', onChange)
  }
  installed = false
  cachedShown = false
  onChange = null
}

// Auto-install in real browser contexts so consumers don't have to remember
// to wire it from a top-level mount. Tests run in Node and import the module
// before setting globalThis.visualViewport, so this no-ops there and tests
// install explicitly.
if (typeof globalThis !== 'undefined' && globalThis.visualViewport) {
  installKeyboardShownTracker()
}
