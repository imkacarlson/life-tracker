import { useEffect } from 'react'
import { isKeyboardShown } from '../utils/keyboardShown'
import { scrollSelectionIntoViewWithToolbar } from '../utils/scrollIntoViewWithToolbar'

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
 * resize and re-runs the existing toolbar-aware caret scroll once the viewport
 * has settled — reusing the same math the selection paths use, no new geometry.
 *
 * The toolbar lift (useMobileToolbarTransform) is also rAF-scheduled off the
 * same resize event; we use a second rAF before measuring so the toolbar's
 * transform write lands first and getToolbarSafeBounds reads its lifted rect.
 * This mirrors the double-rAF convention in useKeepCursorVisible / EditorPanel.
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

    let rafId = null

    const run = () => {
      rafId = null
      const editorFocused = Boolean(editor.view?.hasFocus?.())
      if (!shouldKeepCaretAboveKeyboard({ keyboardShown: isKeyboardShown(), editorFocused })) {
        return
      }
      try {
        scrollSelectionIntoViewWithToolbar({
          view: editor.view,
          container: editorPanelRef?.current ?? null,
          toolbarEl: toolbarRef?.current ?? null,
          padding,
        })
      } catch {
        // ProseMirror may not have a measurable selection during teardown.
      }
    }

    // Listen to resize only — `scroll` is the user panning, which we must not
    // fight. Coalesce bursts with a first rAF; a second rAF lets the toolbar
    // transform (also rAF-scheduled off this resize) settle before we measure.
    const schedule = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = requestAnimationFrame(run)
      })
    }

    viewport.addEventListener('resize', schedule)

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      viewport.removeEventListener('resize', schedule)
    }
  }, [enabled, editor, toolbarRef, editorPanelRef, padding])
}
