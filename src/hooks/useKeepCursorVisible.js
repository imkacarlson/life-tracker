import { useEffect } from 'react'
import {
  computeScrollAdjustment,
  getToolbarSafeBottom,
  pickScrollSurface,
} from '../utils/scrollIntoViewWithToolbar'

/**
 * Keep the cursor / current selection visible whenever the mobile toolbar
 * changes height (expand or collapse).
 *
 * Ported from Notesnook's keep-in-view pattern
 * (packages/editor/src/extensions/keep-in-view/keep-in-view.ts):
 *   - measure the current selection rect via ProseMirror's coordsAtPos
 *     (falls back to window.getSelection when the contenteditable owns focus)
 *   - use the toolbar's top edge as the bottom of the safe zone
 *   - scrollBy a bidirectional signed delta so the cursor lands inside the
 *     visible band, regardless of whether the editor currently has focus
 *
 * Runs on every transition of `toolbarExpanded` so collapse also recenters.
 *
 * @param {{ enabled: boolean, editor: object, toolbarExpanded: boolean, toolbarRef: React.RefObject, editorPanelRef?: React.RefObject, padding?: number }} opts
 */
export function useKeepCursorVisible({
  enabled,
  editor,
  toolbarExpanded,
  toolbarRef,
  editorPanelRef,
  padding = 16,
}) {
  useEffect(() => {
    if (!enabled) return
    if (!editor) return
    if (!toolbarRef?.current) return

    let rafId = null

    const run = () => {
      rafId = null
      const toolbarEl = toolbarRef.current
      if (!toolbarEl) return

      // Prefer the native selection rect when the editor has focus — it's
      // pixel-accurate. Fall back to ProseMirror's coordsAtPos so we still
      // scroll when the user tapped the toggle without focusing the editor.
      let cursorTop = null
      let cursorBottom = null

      if (editor.view?.hasFocus?.()) {
        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0) {
          const rect = sel.getRangeAt(0).getBoundingClientRect()
          if (rect.height > 0) {
            cursorTop = rect.top
            cursorBottom = rect.bottom
          }
        }
      }

      if (cursorBottom === null) {
        try {
          const { head } = editor.state.selection
          const coords = editor.view.coordsAtPos(head)
          cursorTop = coords.top
          cursorBottom = coords.bottom
        } catch {
          return
        }
      }

      const surface = pickScrollSurface(editorPanelRef?.current ?? null)
      const surfaceRect = surface.getRect()
      const safeBottom = getToolbarSafeBottom({
        surfaceBottom: surfaceRect.bottom,
        toolbarEl,
        padding,
      })

      const delta = computeScrollAdjustment({
        cursorTop,
        cursorBottom,
        safeTop: surfaceRect.top,
        safeBottom,
        padding,
      })

      if (delta !== 0) surface.scrollBy({ top: delta })
    }

    // Two rAFs: first lets the CSS expand/collapse animation start and the
    // ResizeObserver write the new --toolbar-height; second reads the
    // settled toolbar rect.
    rafId = requestAnimationFrame(() => {
      rafId = requestAnimationFrame(run)
    })

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [enabled, editor, toolbarExpanded, toolbarRef, editorPanelRef, padding])
}
