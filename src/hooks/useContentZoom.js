import { useEffect, useRef, useState, useCallback } from 'react'
import {
  pinchDistance,
  pinchMidpoint,
  clampZoom,
  anchoredScrollY,
  anchoredScrollX,
  MIN_ZOOM,
  MAX_ZOOM,
} from '../utils/zoomHelpers'

const ZOOM_HINT_KEY = 'life-tracker-zoom-hint-seen'

/**
 * Pinch-to-zoom for the editor content area via CSS `zoom`.
 *
 * - Only activates on touch-only devices (passed as `isTouchOnly`)
 * - Applies zoom imperatively (no React re-renders during gesture)
 * - Syncs React state on touchend for badge visibility
 *
 * @param {React.RefObject} shellRef — ref to the .editor-shell DOM element
 * @param {boolean} isTouchOnly — from EditorPanel's existing memo
 * @returns {{ zoomLevel: number, resetZoom: () => void, showHint: boolean, dismissHint: () => void }}
 */
export function useContentZoom(shellRef, isTouchOnly) {
  const [zoomLevel, setZoomLevel] = useState(1.0)
  const [showHint, setShowHint] = useState(false)

  // Refs for imperative gesture handling (no re-renders during pinch)
  const zoomRef = useRef(1.0)
  const startDistRef = useRef(0)
  const startZoomRef = useRef(1.0)
  const rafIdRef = useRef(null)
  const isPinchingRef = useRef(false)
  const gestureEndTimerRef = useRef(null)
  const hintTimerRef = useRef(null)
  const [gestureRecent, setGestureRecent] = useState(false)

  // Feature detection: CSS zoom support
  const supportsZoom = typeof document !== 'undefined' &&
    'zoom' in document.documentElement.style

  const resetZoom = useCallback(() => {
    const el = shellRef.current
    if (!el) return

    // Use CSS transition for smooth reset
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!reducedMotion) {
      el.style.transition = 'zoom 200ms ease-out'
      const cleanup = () => {
        el.style.transition = ''
        el.removeEventListener('transitionend', cleanup)
        clearTimeout(fallbackTimer)
      }
      el.addEventListener('transitionend', cleanup)
      // Fallback: if transitionend never fires (zoom transition not supported),
      // clean up after 300ms to prevent handler leak
      const fallbackTimer = setTimeout(cleanup, 300)
    }

    el.style.zoom = ''
    zoomRef.current = 1.0
    setZoomLevel(1.0)
  }, [shellRef])

  const dismissHint = useCallback(() => {
    setShowHint(false)
    if (hintTimerRef.current) {
      clearTimeout(hintTimerRef.current)
      hintTimerRef.current = null
    }
    try {
      localStorage.setItem(ZOOM_HINT_KEY, '1')
    } catch {
      // localStorage not available
    }
  }, [])

  // Pinch gesture listeners
  useEffect(() => {
    if (!isTouchOnly || !supportsZoom) return
    const el = shellRef.current
    if (!el) return

    const onTouchStart = (e) => {
      if (e.touches.length !== 2) return

      isPinchingRef.current = true
      startDistRef.current = pinchDistance(e.touches[0], e.touches[1])
      startZoomRef.current = zoomRef.current
    }

    const onTouchMove = (e) => {
      if (!isPinchingRef.current || e.touches.length !== 2) return

      // Cancel any pending rAF
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
      }

      const touch0 = e.touches[0]
      const touch1 = e.touches[1]

      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null

        const currentDist = pinchDistance(touch0, touch1)
        if (startDistRef.current === 0) return

        const scale = currentDist / startDistRef.current
        const oldZoom = zoomRef.current
        const newZoom = clampZoom(startZoomRef.current * scale)

        if (newZoom === oldZoom) return

        // Apply zoom imperatively
        el.style.zoom = String(newZoom)
        zoomRef.current = newZoom

        // Midpoint anchoring — keep pinch center visually fixed
        const mid = pinchMidpoint(touch0, touch1)
        const newScrollY = anchoredScrollY(window.scrollY, mid.y, oldZoom, newZoom)
        const newScrollX = anchoredScrollX(window.scrollX, mid.x, oldZoom, newZoom)
        window.scrollTo(newScrollX, newScrollY)
      })
    }

    const onTouchEnd = (e) => {
      // Only end pinch when fewer than 2 fingers remain
      if (e.touches.length < 2 && isPinchingRef.current) {
        isPinchingRef.current = false

        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current)
          rafIdRef.current = null
        }

        // Sync to React state for badge
        setZoomLevel(zoomRef.current)

        // Track "gesture recent" for badge opacity
        setGestureRecent(true)
        if (gestureEndTimerRef.current) clearTimeout(gestureEndTimerRef.current)
        gestureEndTimerRef.current = setTimeout(() => {
          setGestureRecent(false)
        }, 2000)
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current)
      if (gestureEndTimerRef.current) clearTimeout(gestureEndTimerRef.current)
    }
  }, [isTouchOnly, supportsZoom, shellRef])

  // First-use hint: detect wide table on touch devices
  useEffect(() => {
    if (!isTouchOnly || !supportsZoom) return
    const el = shellRef.current
    if (!el) return

    // Already seen?
    try {
      if (localStorage.getItem(ZOOM_HINT_KEY)) return
    } catch {
      return
    }

    const scheduleAutoDismiss = () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
      hintTimerRef.current = setTimeout(() => {
        hintTimerRef.current = null
        setShowHint(false)
        try {
          localStorage.setItem(ZOOM_HINT_KEY, '1')
        } catch {
          // ignore
        }
      }, 4000)
    }

    const observer = new MutationObserver(() => {
      const wrapper = el.querySelector('.tableWrapper')
      if (wrapper && wrapper.scrollWidth > wrapper.clientWidth) {
        setShowHint(true)
        observer.disconnect()
        scheduleAutoDismiss()
      }
    })

    observer.observe(el, { childList: true, subtree: true })

    // Also check immediately in case content is already loaded
    const wrapper = el.querySelector('.tableWrapper')
    if (wrapper && wrapper.scrollWidth > wrapper.clientWidth) {
      setShowHint(true)
      observer.disconnect()
      scheduleAutoDismiss()
    }

    return () => {
      observer.disconnect()
      if (hintTimerRef.current) {
        clearTimeout(hintTimerRef.current)
        hintTimerRef.current = null
      }
    }
  }, [isTouchOnly, supportsZoom, shellRef])

  return {
    zoomLevel,
    resetZoom,
    showHint,
    dismissHint,
    gestureRecent,
    isZoomSupported: isTouchOnly && supportsZoom,
  }
}
