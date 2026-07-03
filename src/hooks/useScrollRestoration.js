import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { TextSelection } from '@tiptap/pm/state'
import { getEditorScrollSurface } from '../utils/scrollIntoViewWithToolbar'
import { isKeyboardShown } from '../utils/keyboardShown'
import { readStoredScrollPositions, saveStoredScrollPositions } from '../utils/storage'

// Debounce only the sessionStorage write — the in-memory map updates on every
// scroll so switching pages always has the latest offset to hand.
const PERSIST_DEBOUNCE_MS = 350
// If layout never grows tall enough for the saved offset, apply our best effort
// after this long and stop waiting.
const RESTORE_TIMEOUT_MS = 1500
const TOUCH_RESTORE_TIMEOUT_MS = 3000
// The restored offset must hold (surface tall enough, offset within ~2px) for
// this long before we declare success. This is what lets us survive the
// remount reflow: the post-restore clamp shrinks the surface, so a later tick
// reads not-reached, resets the hold timer, and we re-assert and wait again
// instead of finishing on the first (transient) success.
const RESTORE_SETTLE_MS = 250
// How close the surface offset must be to the saved offset to count as reached.
const RESTORE_REACHED_TOLERANCE_PX = 2

/**
 * Per-page scroll restoration for the editor surface.
 *
 * - Save: an in-memory `Map<pageId, scrollTop>` records the active page's offset
 *   on every scroll (cheap); the sessionStorage mirror is debounced.
 * - Restore: on a page change (once content is `ready`) the saved offset is
 *   re-applied via a bounded requestAnimationFrame settle loop that polls the
 *   live scroll surface each frame, waiting for the content to grow tall enough
 *   (images/tables load late, and the sessionKey editor remount lays out short
 *   at first) and re-asserting the offset until it holds. Fresh pages (no
 *   memory) reset to the top.
 * - Selection: the current ProseMirror selection is saved alongside the scroll
 *   offset and restored without calling scrollIntoView, so returning to a page
 *   puts the cursor/selection back where it was without fighting scroll restore.
 *
 * Surface detection (desktop `.editor-panel` vs mobile window) is delegated to
 * `getEditorScrollSurface`. Restoration defers to the keyboard
 * (`useKeepCaretAboveKeyboard`) and pinch-zoom (`useContentZoom`) on mobile, and
 * to deep-link block scrolling via the `skip` flag.
 *
 * @param {object} params
 * @param {React.RefObject<HTMLElement>} params.containerRef - the `.editor-panel`
 * @param {import('@tiptap/react').Editor|null} params.editor
 * @param {string|null} params.pageId
 * @param {boolean} params.ready - content rendered (not locked/transitioning)
 * @param {boolean} [params.skip] - defer entirely (e.g. a deep-link block jump owns scroll)
 * @param {number} [params.zoomLevel] - current pinch-zoom level; restore is skipped while !== 1
 * @param {boolean} [params.isTouchOnly] - true on the mobile/touch-only layout
 */
export function useScrollRestoration({
  containerRef,
  editor,
  pageId,
  ready,
  skip = false,
  zoomLevel = 1,
  isTouchOnly = false,
}) {
  // Hydrate the in-memory map from sessionStorage exactly once.
  const positionsRef = useRef(null)
  if (positionsRef.current === null) {
    positionsRef.current = new Map(Object.entries(readStoredScrollPositions()))
  }

  const persistTimerRef = useRef(null)
  const restoringRef = useRef(false)
  const pageIdRef = useRef(pageId)
  const editorRef = useRef(editor)
  const zoomRef = useRef(zoomLevel)

  // Mirror the latest props into refs so the long-lived scroll listener and the
  // restore guards read current values without re-subscribing every change.
  useEffect(() => {
    pageIdRef.current = pageId
  }, [pageId])
  useEffect(() => {
    editorRef.current = editor
  }, [editor])
  useEffect(() => {
    zoomRef.current = zoomLevel
  }, [zoomLevel])

  const persist = useCallback(() => {
    saveStoredScrollPositions(Object.fromEntries(positionsRef.current))
  }, [])

  const schedulePersist = useCallback(() => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null
      persist()
    }, PERSIST_DEBOUNCE_MS)
  }, [persist])

  const flushPersist = useCallback(() => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current)
      persistTimerRef.current = null
    }
    persist()
  }, [persist])

  // While the keyboard is up or the content is zoomed, other hooks own the
  // scroll — don't fight them.
  const mobileOwnsScroll = useCallback(() => isKeyboardShown() || zoomRef.current !== 1, [])

  const readEditorSelection = useCallback(() => {
    const currentEditor = editorRef.current
    if (!currentEditor || currentEditor.isDestroyed) return null
    const selection = currentEditor.state?.selection
    if (!selection) return null
    const from = Number(selection.from)
    const to = Number(selection.to)
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null
    return { from, to }
  }, [])

  const captureCurrentState = useCallback(
    ({
      id = pageIdRef.current,
      immediate = false,
      force = false,
      includeScroll = true,
    } = {}) => {
      if (!id) return
      if (!force) {
        if (restoringRef.current) return
        if (mobileOwnsScroll()) return
      }
      const previous = positionsRef.current.get(id) ?? {}
      const next = { ...previous }
      if (includeScroll || typeof next.scrollTop !== 'number') {
        const surface = getEditorScrollSurface(containerRef.current)
        next.scrollTop = surface.get()
      }
      const selection = readEditorSelection()
      if (selection) next.selection = selection
      positionsRef.current.delete(id)
      positionsRef.current.set(id, next)

      if (immediate) {
        flushPersist()
      } else {
        schedulePersist()
      }
    },
    [containerRef, flushPersist, mobileOwnsScroll, readEditorSelection, schedulePersist],
  )

  const restoreEditorSelection = useCallback((selection) => {
    const currentEditor = editorRef.current
    if (!currentEditor || currentEditor.isDestroyed || !selection) return
    const doc = currentEditor.state?.doc
    if (!doc) return
    const max = doc.content.size
    const clampPos = (value) => Math.max(0, Math.min(max, Number(value)))
    const from = clampPos(selection.from)
    const to = clampPos(selection.to)
    if (!Number.isFinite(from) || !Number.isFinite(to)) return
    try {
      const nextSelection = TextSelection.between(doc.resolve(from), doc.resolve(to))
      const tr = currentEditor.state.tr.setSelection(nextSelection)
      currentEditor.view.dispatch(tr)
    } catch {
      // Ignore stale positions; content may have changed since this state was saved.
    }
  }, [])

  // Flush pending persisted state before React swaps in the next editor. Do not
  // sample scroll here: teardown/remount can temporarily collapse the panel and
  // report scrollTop 0, which would overwrite the real user offset.
  useEffect(() => {
    if (!ready || !pageId) return undefined
    return () => flushPersist()
  }, [pageId, ready, flushPersist])

  // --- Save listener -------------------------------------------------------
  useLayoutEffect(() => {
    if (!ready || !pageId || skip) return undefined
    const container = containerRef.current

    const recordOffset = () => {
      const surface = getEditorScrollSurface(container)
      if (isTouchOnly && surface.target === window) {
        const hashPageId = new URLSearchParams(window.location.hash.slice(1)).get('pg')
        if (hashPageId !== pageId) return
      }
      captureCurrentState()
    }

    // Whichever surface scrolls, recordOffset reads the correct one.
    if (container) container.addEventListener('scroll', recordOffset, { passive: true })
    window.addEventListener('scroll', recordOffset, { capture: true, passive: true })
    // Flush immediately when the page is being hidden/unloaded so a reload
    // within the debounce window doesn't lose the latest offset.
    const flush = () => {
      captureCurrentState({ id: pageId, immediate: true, force: true })
    }
    window.addEventListener('pagehide', flush)

    return () => {
      if (container) container.removeEventListener('scroll', recordOffset)
      window.removeEventListener('scroll', recordOffset, true)
      window.removeEventListener('pagehide', flush)
      flushPersist()
    }
  }, [containerRef, pageId, ready, skip, isTouchOnly, captureCurrentState, flushPersist])

  // Save cursor/selection changes even when the user has not scrolled.
  useEffect(() => {
    if (!editor || !ready || !pageId || skip) return undefined
    const recordSelection = () => captureCurrentState({ includeScroll: false })
    editor.on('selectionUpdate', recordSelection)
    editor.on('transaction', recordSelection)
    return () => {
      editor.off('selectionUpdate', recordSelection)
      editor.off('transaction', recordSelection)
      flushPersist()
    }
  }, [editor, pageId, ready, skip, captureCurrentState, flushPersist])

  // --- Restore on page change ---------------------------------------------
  useEffect(() => {
    if (!ready || !pageId) return undefined
    if (skip) {
      return undefined
    }

    const saved = positionsRef.current.get(pageId)
    const savedScrollTop =
      typeof saved === 'number' ? saved : typeof saved?.scrollTop === 'number' ? saved.scrollTop : null
    const initialSurface = getEditorScrollSurface(containerRef.current)
    const getMaxScrollableOffset = (surface) =>
      Math.max(0, surface.getScrollHeight() - surface.getClientHeight())

    if (savedScrollTop == null) {
      // No memory for this page → start at the top. The scroll container is
      // reused across page switches, so its scrollTop would otherwise carry over.
      const raf = requestAnimationFrame(() => {
        restoringRef.current = true
        initialSurface.set(0)
        restoringRef.current = false
      })
      return () => cancelAnimationFrame(raf)
    }

    // Mobile guards own scroll right now — leave the offset alone.
    if (mobileOwnsScroll()) return undefined

    restoringRef.current = true
    let cancelled = false
    let timer = null
    let raf = null
    // Timestamp (ms) since which the offset has held "reached" continuously.
    // Reset to null on any not-reached tick so a late clamp restarts the hold.
    let reachedSince = null
    const restoreTimeoutMs = isTouchOnly ? TOUCH_RESTORE_TIMEOUT_MS : RESTORE_TIMEOUT_MS

    const finish = () => {
      restoringRef.current = false
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (raf) {
        cancelAnimationFrame(raf)
        raf = null
      }
    }

    // Offset 0 always fits, so there is nothing to wait on: apply it, restore the
    // caret (contract: a saved offset of 0 carries no scroll info, so the caret
    // wins), and finish immediately.
    if (savedScrollTop <= 0) {
      initialSurface.set(0)
      restoreEditorSelection(saved.selection)
      finish()
      return () => {
        cancelled = true
        finish()
      }
    }

    // Bounded rAF settle loop: poll the *live* scroll surface every frame rather
    // than a proxy DOM node. This reads the current scrollHeight/clientHeight/
    // scrollTop directly, so it doesn't matter which child grows or whether the
    // recreated editor DOM has mounted yet — we observe reality. We re-assert
    // set() every tick (idempotent) so a late clamp from the sessionKey remount
    // reflow is immediately corrected, and require the offset to HOLD for
    // RESTORE_SETTLE_MS before declaring success. restoringRef stays true across
    // the whole window so captureCurrentState can't persist a transient clamp.
    const tick = () => {
      if (cancelled) return
      // Keyboard/pinch-zoom own scroll on mobile — hand off, don't fight them.
      if (mobileOwnsScroll()) {
        finish()
        return
      }
      const surface = getEditorScrollSurface(containerRef.current)
      const max = getMaxScrollableOffset(surface)
      if (max >= savedScrollTop) {
        // Tall enough: re-assert the saved offset (beats any late clamp).
        surface.set(savedScrollTop)
        const reached = Math.abs(surface.get() - savedScrollTop) <= RESTORE_REACHED_TOLERANCE_PX
        if (reached) {
          if (reachedSince == null) reachedSince = performance.now()
          if (performance.now() - reachedSince >= RESTORE_SETTLE_MS) {
            finish()
            return
          }
        } else {
          reachedSince = null
        }
      } else {
        // Surface still too short (or a clamp shrank it): don't apply a low value
        // and don't count as reached — just keep polling until it grows.
        reachedSince = null
      }
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)

    timer = setTimeout(() => {
      // Outer safety net for a page genuinely shorter than the saved offset:
      // apply our best effort (clamped) and stop waiting.
      if (!cancelled && !mobileOwnsScroll()) {
        const surface = getEditorScrollSurface(containerRef.current)
        const max = getMaxScrollableOffset(surface)
        surface.set(Math.min(savedScrollTop, max))
      }
      finish()
    }, restoreTimeoutMs)

    return () => {
      cancelled = true
      finish()
    }
  }, [pageId, ready, skip, containerRef, isTouchOnly, mobileOwnsScroll, restoreEditorSelection])
}
