import { useCallback, useEffect, useRef } from 'react'
import { getEditorScrollSurface } from '../utils/scrollIntoViewWithToolbar'
import { isKeyboardShown } from '../utils/keyboardShown'
import { readStoredScrollPositions, saveStoredScrollPositions } from '../utils/storage'

// Debounce only the sessionStorage write — the in-memory map updates on every
// scroll so switching pages always has the latest offset to hand.
const PERSIST_DEBOUNCE_MS = 350
// If layout never grows tall enough for the saved offset, apply our best effort
// after this long and stop waiting.
const RESTORE_TIMEOUT_MS = 1500

/**
 * Per-page scroll restoration for the editor surface.
 *
 * - Save: an in-memory `Map<pageId, scrollTop>` records the active page's offset
 *   on every scroll (cheap); the sessionStorage mirror is debounced.
 * - Restore: on a page change (once content is `ready`) the saved offset is
 *   re-applied, waiting via ResizeObserver for the content to grow tall enough
 *   (images/tables load late) before scrolling — Notesnook's restoreScrollPosition
 *   mechanism. Fresh pages (no memory) reset to the top.
 *
 * Surface detection (desktop `.editor-panel` vs mobile window) is delegated to
 * `getEditorScrollSurface`. Restoration defers to the keyboard
 * (`useKeepCaretAboveKeyboard`) and pinch-zoom (`useContentZoom`) on mobile, and
 * to deep-link block scrolling via the `skip` flag.
 *
 * @param {object} params
 * @param {React.RefObject<HTMLElement>} params.containerRef - the `.editor-panel`
 * @param {string|null} params.pageId
 * @param {boolean} params.ready - content rendered (not locked/transitioning)
 * @param {boolean} [params.skip] - defer entirely (e.g. a deep-link block jump owns scroll)
 * @param {number} [params.zoomLevel] - current pinch-zoom level; restore is skipped while !== 1
 */
export function useScrollRestoration({ containerRef, pageId, ready, skip = false, zoomLevel = 1 }) {
  // Hydrate the in-memory map from sessionStorage exactly once.
  const positionsRef = useRef(null)
  if (positionsRef.current === null) {
    positionsRef.current = new Map(Object.entries(readStoredScrollPositions()))
  }

  const persistTimerRef = useRef(null)
  const restoringRef = useRef(false)
  const pageIdRef = useRef(pageId)
  const zoomRef = useRef(zoomLevel)
  // The page whose scroll we've already settled this navigation, so that a
  // `skip` toggle (e.g. a deep-link block jump finishing) doesn't re-run restore
  // and yank the page back to the top.
  const handledPageRef = useRef(null)

  // Mirror the latest props into refs so the long-lived scroll listener and the
  // restore guards read current values without re-subscribing every change.
  useEffect(() => {
    pageIdRef.current = pageId
  }, [pageId])
  useEffect(() => {
    zoomRef.current = zoomLevel
  }, [zoomLevel])

  const persist = useCallback(() => {
    saveStoredScrollPositions(Object.fromEntries(positionsRef.current))
  }, [])

  // While the keyboard is up or the content is zoomed, other hooks own the
  // scroll — don't fight them.
  const mobileOwnsScroll = useCallback(() => isKeyboardShown() || zoomRef.current !== 1, [])

  // --- Save listener -------------------------------------------------------
  useEffect(() => {
    if (skip) return undefined
    const container = containerRef.current

    const recordOffset = () => {
      if (restoringRef.current) return
      if (mobileOwnsScroll()) return
      const id = pageIdRef.current
      if (!id) return
      const surface = getEditorScrollSurface(containerRef.current)
      const top = surface.get()
      // Re-insert so this page becomes the most-recent (tail) entry.
      positionsRef.current.delete(id)
      positionsRef.current.set(id, top)
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
      persistTimerRef.current = setTimeout(() => {
        persistTimerRef.current = null
        persist()
      }, PERSIST_DEBOUNCE_MS)
    }

    // Whichever surface scrolls, recordOffset reads the correct one.
    if (container) container.addEventListener('scroll', recordOffset, { passive: true })
    window.addEventListener('scroll', recordOffset, { passive: true })
    // Flush immediately when the page is being hidden/unloaded so a reload
    // within the debounce window doesn't lose the latest offset.
    const flush = () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current)
        persistTimerRef.current = null
      }
      persist()
    }
    window.addEventListener('pagehide', flush)

    return () => {
      if (container) container.removeEventListener('scroll', recordOffset)
      window.removeEventListener('scroll', recordOffset)
      window.removeEventListener('pagehide', flush)
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current)
        persistTimerRef.current = null
        persist()
      }
    }
  }, [containerRef, skip, persist, mobileOwnsScroll])

  // --- Restore on page change ---------------------------------------------
  useEffect(() => {
    if (!ready || !pageId) return undefined
    if (skip) {
      // A deep-link block jump owns scroll for this page; mark it handled so we
      // don't reset it to the top once the deep link clears.
      handledPageRef.current = pageId
      return undefined
    }
    // Only settle each page once per navigation to it.
    if (handledPageRef.current === pageId) return undefined
    handledPageRef.current = pageId

    const saved = positionsRef.current.get(pageId)
    const initialSurface = getEditorScrollSurface(containerRef.current)

    if (saved == null) {
      // No memory for this page → start at the top. The scroll container is
      // reused across page switches, so its scrollTop would otherwise carry over.
      const raf = requestAnimationFrame(() => initialSurface.set(0))
      return () => cancelAnimationFrame(raf)
    }

    // Mobile guards own scroll right now — leave the offset alone.
    if (mobileOwnsScroll()) return undefined

    restoringRef.current = true
    let cancelled = false
    let observer = null
    let timer = null
    let raf = null

    const finish = () => {
      restoringRef.current = false
      if (observer) {
        observer.disconnect()
        observer = null
      }
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (raf) {
        cancelAnimationFrame(raf)
        raf = null
      }
    }

    const getMaxScrollableOffset = (surface) =>
      Math.max(0, surface.getScrollHeight() - surface.getClientHeight())

    const tryApply = () => {
      if (cancelled) return false
      if (mobileOwnsScroll()) return false
      const surface = getEditorScrollSurface(containerRef.current)
      if (getMaxScrollableOffset(surface) >= saved) {
        surface.set(saved)
        return true
      }
      return false
    }

    if (getMaxScrollableOffset(initialSurface) >= saved) {
      // Already tall enough — apply on the next frame in a single pass.
      raf = requestAnimationFrame(() => {
        tryApply()
        finish()
      })
    } else if (typeof ResizeObserver !== 'undefined') {
      // Wait for content to grow tall enough, then apply once and disconnect.
      observer = new ResizeObserver(() => {
        if (tryApply()) finish()
      })
      const observeTarget = containerRef.current?.firstElementChild ?? containerRef.current
      if (observeTarget) observer.observe(observeTarget)
      if (typeof document !== 'undefined' && document.body) observer.observe(document.body)
      timer = setTimeout(() => {
        // Safety net: apply our best effort (clamped) and stop waiting.
        if (!cancelled && !mobileOwnsScroll()) {
          const surface = getEditorScrollSurface(containerRef.current)
          surface.set(Math.min(saved, getMaxScrollableOffset(surface)))
        }
        finish()
      }, RESTORE_TIMEOUT_MS)
    } else {
      raf = requestAnimationFrame(() => {
        tryApply()
        finish()
      })
    }

    return () => {
      cancelled = true
      finish()
    }
  }, [pageId, ready, skip, containerRef, mobileOwnsScroll])
}
