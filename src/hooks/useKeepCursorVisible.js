import { useEffect } from 'react'
import { computeScrollDelta } from '../utils/cursorVisibility'

/**
 * When the mobile toolbar expands, scroll so the cursor stays visible above it.
 *
 * Trigger: `toolbarExpanded` transitioning to true.
 * Method: measure cursor rect (window.getSelection, fallback to coordsAtPos),
 * measure toolbar top edge via getBoundingClientRect, then scrollBy the delta.
 *
 * Ported from Notesnook's keep-in-view pattern:
 * packages/editor/src/extensions/keep-in-view/keep-in-view.ts
 * Their approach: detect toolbar via DOM querySelector, add 60px buffer,
 * walk up DOM for scroll container, scrollBy with smooth behavior.
 *
 * @param {{ enabled: boolean, editor: object, toolbarExpanded: boolean, toolbarRef: React.RefObject, padding: number }} opts
 */
export function useKeepCursorVisible({ enabled, editor, toolbarExpanded, toolbarRef, padding = 16 }) {
  useEffect(() => {
    if (!enabled) return
    if (!toolbarExpanded) return
    if (!editor) return
    if (!toolbarRef?.current) return
    if (!window.visualViewport) return

    let rafId = null

    const run = () => {
      rafId = null
      if (!editor.view.hasFocus()) return

      // Get cursor rect — prefer native selection for accuracy
      let cursorBottom = null
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0) {
        const rect = sel.getRangeAt(0).getBoundingClientRect()
        if (rect.height > 0) cursorBottom = rect.bottom
      }

      // Fall back to ProseMirror's coordsAtPos when native rect is zero-sized
      if (cursorBottom === null) {
        const { head } = editor.state.selection
        const coords = editor.view.coordsAtPos(head)
        cursorBottom = coords.bottom
      }

      if (cursorBottom === null) return

      const toolbarTop = toolbarRef.current.getBoundingClientRect().top
      const safeBottom = toolbarTop - padding

      const delta = computeScrollDelta({ cursorBottom, safeBottom })
      if (delta > 0) {
        window.scrollBy({ top: delta, behavior: 'smooth' })
      }
    }

    // Two rAFs: first lets the CSS expand animation start and the
    // ResizeObserver write the new --toolbar-height, second reads
    // the settled toolbar rect.
    rafId = requestAnimationFrame(() => {
      rafId = requestAnimationFrame(run)
    })

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [enabled, editor, toolbarExpanded, toolbarRef, padding])
}
