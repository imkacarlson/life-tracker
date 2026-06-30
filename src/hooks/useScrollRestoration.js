import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { TextSelection } from '@tiptap/pm/state'
import { getEditorScrollSurface } from '../utils/scrollIntoViewWithToolbar'
import { getMountedEditorView } from '../utils/editorView'
import { isKeyboardShown } from '../utils/keyboardShown'
import { readStoredScrollPositions, saveStoredScrollPositions } from '../utils/storage'

// Debounce only the sessionStorage write — the in-memory map updates on every
// scroll so switching pages always has the latest offset to hand.
const PERSIST_DEBOUNCE_MS = 350
// If layout never grows tall enough for the saved offset, apply our best effort
// after this long and stop waiting.
const RESTORE_TIMEOUT_MS = 1500
const TOUCH_RESTORE_TIMEOUT_MS = 3000

/**
 * Per-page scroll restoration for the editor surface.
 *
 * - Save: an in-memory `Map<pageId, scrollTop>` records the active page's offset
 *   on every scroll (cheap); the sessionStorage mirror is debounced.
 * - Restore: on a page change (once content is `ready`) the saved offset is
 *   re-applied, waiting via ResizeObserver for the content to grow tall enough
 *   (images/tables load late) before scrolling — Notesnook's restoreScrollPosition
 *   mechanism. Fresh pages (no memory) reset to the top.
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
    let observer = null
    let timer = null
    let raf = null
    const restoreTimeoutMs = isTouchOnly ? TOUCH_RESTORE_TIMEOUT_MS : RESTORE_TIMEOUT_MS

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

    const tryApply = ({ settle = false } = {}) => {
      if (cancelled) return false
      if (mobileOwnsScroll()) return false
      const surface = getEditorScrollSurface(containerRef.current)
      const max = getMaxScrollableOffset(surface)
      if (max <= 0) return false
      const applied = Math.min(savedScrollTop, max)
      // Contract: a saved offset of 0 carries no scroll information, so we restore
      // the caret/selection instead. When the offset is non-zero, scroll position
      // wins and we deliberately do NOT also restore the caret. Known gap: a page
      // with both a deep scroll and a deep selection won't restore the caret —
      // acceptable, since the visible scroll position is what the user expects back.
      if (applied === 0) restoreEditorSelection(saved.selection)
      surface.set(applied)
      return max >= savedScrollTop || settle
    }

    if (typeof ResizeObserver !== 'undefined') {
      // Late-loading content (images/tables) can grow the surface tall enough for
      // the saved offset only after the first paint. A ResizeObserver reacts to
      // that growth directly — the principled waiter — and also fires once on
      // observe, so an already-tall page applies immediately. No polling loop is
      // needed; a single timeout is the only safety net. (The earlier 80ms
      // retry-poll was symptom-chasing for the now-fixed remount crash + surface
      // bugs and has been removed.)
      observer = new ResizeObserver(() => {
        if (tryApply()) finish()
      })
      const observeTarget = containerRef.current?.firstElementChild ?? containerRef.current
      if (observeTarget) observer.observe(observeTarget)
      // Touch-only: also observe the editor DOM so late image layout on the mobile
      // window surface re-triggers apply (gates the image-page E2E case). Read via
      // the shared guard because editor.view throws during the remount window.
      const editorDom = getMountedEditorView(editorRef.current)?.dom ?? null
      if (isTouchOnly && editorDom) observer.observe(editorDom)
      if (typeof document !== 'undefined' && document.body) observer.observe(document.body)
      timer = setTimeout(() => {
        // Safety net: apply our best effort (clamped) and stop waiting.
        if (!cancelled && !mobileOwnsScroll()) {
          tryApply({ settle: true })
        }
        finish()
      }, restoreTimeoutMs)
    } else {
      raf = requestAnimationFrame(() => {
        tryApply({ settle: true })
        finish()
      })
    }

    return () => {
      cancelled = true
      finish()
    }
  }, [pageId, ready, skip, containerRef, isTouchOnly, mobileOwnsScroll, restoreEditorSelection])
}
