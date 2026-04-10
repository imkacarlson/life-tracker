import { useEffect, useRef, useState } from 'react'

const KEYBOARD_THRESHOLD = 100 // px; filters browser chrome collapse from real keyboard

/**
 * Compute the virtual keyboard height from a known baseline.
 *
 * Exported for unit testing. Pure function — no side effects.
 *
 * @param {number|null} baseline — visualViewport.height captured at editor focus
 * @param {number} currentHeight — current visualViewport.height (or clientHeight fallback)
 * @returns {number} keyboard height in px, or 0 if no keyboard
 */
export function computeKeyboardHeight(baseline, currentHeight) {
  if (baseline === null || baseline === undefined) return 0
  const delta = baseline - currentHeight
  if (delta < KEYBOARD_THRESHOLD) return 0
  return Math.min(delta, currentHeight * 0.6)
}

/**
 * Return an updated baseline, tracking upward when the viewport grows.
 *
 * The URL bar on Android Chrome typically hides when the keyboard opens,
 * which makes visualViewport.height briefly GROW before it shrinks.
 * If the baseline was captured while the URL bar was visible it will be
 * smaller than the post-hide height, causing computeKeyboardHeight to
 * undercount the true keyboard height by ~urlBarHeight (~56 px) and
 * leaving the toolbar partially covered.
 *
 * Fix: any time the viewport grows, update the baseline so it always
 * reflects the largest "no keyboard" height seen since last focus.
 *
 * @param {number|null} baseline — current captured baseline
 * @param {number} currentHeight — latest visualViewport.height
 * @returns {number|null} updated baseline
 */
export function updateBaseline(baseline, currentHeight) {
  if (baseline === null || baseline === undefined) return baseline
  if (currentHeight > baseline) return currentHeight
  return baseline
}

/**
 * Imperative keyboard-height tracking for mobile virtual keyboards.
 *
 * Uses window.visualViewport resize events to track keyboard height in real
 * time, then writes directly to DOM refs (no per-frame React re-renders).
 * Follows the useContentZoom.js pattern: React state updates only on
 * keyboard open/close threshold crossing.
 *
 * Algorithm:
 * 1. Capture baselineHeight at editor focusin
 * 2. On visualViewport resize (+ window.resize fallback for Samsung Internet),
 *    compute delta = baseline - currentHeight
 * 3. If delta < 100px → keyboard is closed; reset to bottom: 0
 * 4. If delta ≥ 100px → keyboard open; lift toolbar to keyboardHeight + safeArea
 * 5. Cap keyboardHeight at 60% of visual height (floating keyboard edge case)
 *
 * @param {object} opts
 * @param {boolean} opts.enabled — true on touch-only devices
 * @param {React.RefObject} opts.toolbarRef — ref to the .toolbar DOM element
 * @param {React.RefObject} [opts.zoomBadgeRef] — ref to .zoom-badge (may be null)
 * @param {React.RefObject} [opts.zoomHintRef] — ref to .zoom-hint (may be null)
 * @returns {{ keyboardOpen: boolean, keyboardHeightRef: React.MutableRefObject<number> }}
 */
export function useVirtualKeyboard({ enabled, toolbarRef, zoomBadgeRef, zoomHintRef }) {
  const [keyboardOpen, setKeyboardOpen] = useState(false)

  // Refs for imperative path (no React re-renders during animation)
  const keyboardOpenRef = useRef(false)
  const keyboardHeightRef = useRef(0)
  const baselineHeightRef = useRef(null)
  const cachedSafeAreaRef = useRef(0)
  const rafIdRef = useRef(null)

  useEffect(() => {
    if (!enabled) return

    let orientationTimeoutId = null
    let orientationRafId1 = null
    let orientationRafId2 = null

    // --- Safe area probe element ---
    // When inline style.bottom overrides CSS bottom, CSS padding-bottom:
    // env(safe-area-inset-bottom) still applies and double-counts the safe area.
    // Fix: measure safe area via probe element; compose it entirely in JS;
    // suppress CSS env() by setting paddingBottom = '0' when keyboard is open.
    const probe = document.createElement('div')
    probe.style.cssText =
      'position:fixed;bottom:0;left:0;width:0;height:env(safe-area-inset-bottom,0px);pointer-events:none;visibility:hidden'
    document.body.appendChild(probe)

    const measureSafeArea = () => {
      const h = parseFloat(getComputedStyle(probe).height) || 0
      cachedSafeAreaRef.current = h
    }
    measureSafeArea()

    const cancelRaf = () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }

    // Apply keyboard-aware positions imperatively to avoid React re-renders.
    const applyPositions = (kbHeight) => {
      const toolbar = toolbarRef.current
      if (!toolbar) return
      const safeArea = cachedSafeAreaRef.current

      if (kbHeight > 0) {
        const bottom = kbHeight + safeArea
        toolbar.style.bottom = bottom + 'px'
        // Suppress CSS env() so safe area isn't applied twice
        toolbar.style.paddingBottom = '0'
        if (zoomBadgeRef?.current) {
          zoomBadgeRef.current.style.bottom = 20 + safeArea + kbHeight + 'px'
        }
        if (zoomHintRef?.current) {
          zoomHintRef.current.style.bottom = 72 + safeArea + kbHeight + 'px'
        }
      } else {
        // Restore CSS-controlled positioning
        toolbar.style.bottom = ''
        toolbar.style.paddingBottom = ''
        if (zoomBadgeRef?.current) {
          zoomBadgeRef.current.style.bottom = ''
        }
        if (zoomHintRef?.current) {
          zoomHintRef.current.style.bottom = ''
        }
      }
    }

    const computeAndApply = () => {
      rafIdRef.current = null

      const vv = window.visualViewport
      // Samsung Internet fallback: documentElement.clientHeight when no visualViewport
      const currentHeight = vv ? vv.height : document.documentElement.clientHeight

      // Self-correcting baseline: if the viewport grew (URL bar hid), track the new
      // maximum so keyboard height is computed against the true full-screen reference.
      baselineHeightRef.current = updateBaseline(baselineHeightRef.current, currentHeight)

      const kbHeight = computeKeyboardHeight(baselineHeightRef.current, currentHeight)
      keyboardHeightRef.current = kbHeight
      applyPositions(kbHeight)

      // Update React state only on threshold crossing (not per-frame)
      const nowOpen = kbHeight > 0
      if (nowOpen !== keyboardOpenRef.current) {
        keyboardOpenRef.current = nowOpen
        setKeyboardOpen(nowOpen)
        // Defer safe-area re-measure to next rAF so the CSS repaint from
        // applyPositions(0) has flushed before getComputedStyle reads the probe.
        if (!nowOpen) requestAnimationFrame(measureSafeArea)
      }
    }

    const scheduleUpdate = () => {
      cancelRaf()
      rafIdRef.current = requestAnimationFrame(computeAndApply)
    }

    // Focus gate: capture baseline when focus enters the editor for the first time.
    // Guard: skip re-capture if the keyboard is already open — tapping toolbar buttons
    // fires focusin at the shrunken viewport height, which would corrupt the baseline
    // and cause the hook to conclude the keyboard closed on the next resize event.
    const handleFocusin = () => {
      if (keyboardOpenRef.current) return
      const vv = window.visualViewport
      baselineHeightRef.current = vv ? vv.height : document.documentElement.clientHeight
      measureSafeArea()
    }

    // Orientation change causes a cascade of resize events with intermediate
    // heights, which would stutter the toolbar. Fix:
    // 1. Null out baseline (re-captures at next focus)
    // 2. Disable CSS transition for 2 frames
    // 3. Reset keyboard state immediately
    const handleOrientationChange = () => {
      baselineHeightRef.current = null
      const toolbar = toolbarRef.current
      if (toolbar) {
        toolbar.style.transition = 'none'
        orientationRafId1 = requestAnimationFrame(() => {
          orientationRafId2 = requestAnimationFrame(() => {
            if (toolbarRef.current) toolbarRef.current.style.transition = ''
          })
        })
      }
      keyboardHeightRef.current = 0
      applyPositions(0)
      if (keyboardOpenRef.current) {
        keyboardOpenRef.current = false
        setKeyboardOpen(false)
      }
      // Re-measure safe area after orientation settles (~300ms for viewport to stabilise)
      clearTimeout(orientationTimeoutId)
      orientationTimeoutId = setTimeout(measureSafeArea, 300)
    }

    const vv = window.visualViewport
    if (vv) {
      vv.addEventListener('resize', scheduleUpdate)
      // scroll fires when the visual viewport pans (keyboard open + user scrolls).
      // Re-applying positions on scroll prevents Chrome Android's compositor from
      // jank-rendering the fixed toolbar at the wrong position mid-scroll.
      vv.addEventListener('scroll', scheduleUpdate)
    } else {
      // Samsung Internet fallback: no visualViewport, use window.resize instead
      window.addEventListener('resize', scheduleUpdate)
    }
    window.addEventListener('orientationchange', handleOrientationChange)
    document.addEventListener('focusin', handleFocusin)

    return () => {
      cancelRaf()
      clearTimeout(orientationTimeoutId)
      cancelAnimationFrame(orientationRafId1)
      cancelAnimationFrame(orientationRafId2)
      if (vv) {
        vv.removeEventListener('resize', scheduleUpdate)
        vv.removeEventListener('scroll', scheduleUpdate)
      } else {
        window.removeEventListener('resize', scheduleUpdate)
      }
      window.removeEventListener('orientationchange', handleOrientationChange)
      document.removeEventListener('focusin', handleFocusin)
      if (probe.parentNode) probe.parentNode.removeChild(probe)
    }
  }, [enabled, toolbarRef, zoomBadgeRef, zoomHintRef])

  return { keyboardOpen, keyboardHeightRef }
}
