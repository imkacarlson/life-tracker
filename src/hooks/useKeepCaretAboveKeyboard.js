import { useEffect } from 'react'
import { isKeyboardShown } from '../utils/keyboardShown'
import { scrollSelectionIntoViewWithToolbar } from '../utils/scrollIntoViewWithToolbar'
import { createSettleLoop } from '../utils/settleLoop'
import { getMountedEditorView } from '../utils/editorView'

// How long to keep re-asserting the caret correction after a qualifying
// keyboard-open resize. Covers the observed ~206 ms native "scroll caret into
// view" override and the ~275 ms second viewport resize, with margin. Each new
// resize refreshes this window (handles the two-phase keyboard open).
const SETTLE_WINDOW_MS = 500

/**
 * Pure decision: should we re-scroll the caret above the keyboard right now?
 *
 * We only act when the on-screen keyboard is actually up *and* the editor holds
 * focus (there is a live caret to keep visible). This keeps us from fighting
 * keyboard-close, address-bar shrink, or background viewport changes.
 *
 * @param {{ keyboardShown: boolean, editorFocused: boolean }} params
 * @returns {boolean}
 */
export function shouldKeepCaretAboveKeyboard({ keyboardShown, editorFocused }) {
  return Boolean(keyboardShown && editorFocused)
}

/**
 * Keep the caret above the on-screen keyboard when it opens on mobile.
 *
 * Opening the keyboard is a visualViewport *resize*, not a selection change, so
 * none of the selection-driven scroll paths fire. This hook listens to that
 * resize and re-runs the existing toolbar-aware caret scroll — reusing the same
 * math the selection paths use, no new geometry.
 *
 * A single correction is not enough: Chrome fires its own native "scroll caret
 * into view" ~206 ms *after* our correction (content-dependent — it happens on
 * plain/bullet text but not inside table cells), which drops the caret back
 * behind the fixed toolbar. So instead of one run we drive a bounded settle
 * loop that re-applies the *idempotent* correction every animation frame until
 * a deadline. Because the correction only scrolls when the caret is actually
 * hidden (delta !== 0), it overrides the late native scroll on the next frame,
 * no-ops once the caret is in-band, and self-terminates at the deadline — it
 * does not fight intentional user panning that keeps the caret visible.
 *
 * The toolbar lift (useMobileToolbarTransform) is also rAF-scheduled off the
 * same resize event; running every frame means the toolbar's lifted transform
 * is read on subsequent ticks, so getToolbarSafeBounds sees its settled rect.
 *
 * No-ops on desktop / non-touch (`enabled` false) or where visualViewport is
 * absent.
 *
 * @param {{ enabled: boolean, editor: object, toolbarRef: React.RefObject, editorPanelRef: React.RefObject, padding?: number }} opts
 */
export function useKeepCaretAboveKeyboard({
  enabled,
  editor,
  toolbarRef,
  editorPanelRef,
  padding = 16,
}) {
  useEffect(() => {
    if (!enabled) return
    if (!editor) return
    const viewport = window.visualViewport
    if (!viewport) return

    let loop = null

    // One frame of work: re-measure the live toolbar + caret rects and scroll
    // only if the caret is hidden. Idempotent, so re-running it across the
    // settle window is safe (no-op once the caret is in-band).
    const tick = () => {
      const view = getMountedEditorView(editor)
      const editorFocused = Boolean(view?.hasFocus())
      if (!shouldKeepCaretAboveKeyboard({ keyboardShown: isKeyboardShown(), editorFocused })) {
        return
      }
      try {
        scrollSelectionIntoViewWithToolbar({
          view,
          container: editorPanelRef?.current ?? null,
          toolbarEl: toolbarRef?.current ?? null,
          padding,
        })
      } catch {
        // ProseMirror may not have a measurable selection during teardown.
      }
    }

    // Listen to resize only — `scroll` is the user panning, which we must not
    // fight. Each qualifying resize opens (or refreshes) a settle window during
    // which `tick` re-runs every frame, so a late native scroll gets corrected
    // on the next frame.
    const schedule = () => {
      if (loop) {
        loop.refresh()
        return
      }
      loop = createSettleLoop({ durationMs: SETTLE_WINDOW_MS, onTick: tick })
    }

    viewport.addEventListener('resize', schedule)

    return () => {
      if (loop) loop.cancel()
      viewport.removeEventListener('resize', schedule)
    }
  }, [enabled, editor, toolbarRef, editorPanelRef, padding])
}
