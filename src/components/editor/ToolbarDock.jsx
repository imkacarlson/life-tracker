import { useEffect, useRef } from 'react'
import { shouldDockToolbar } from '../../utils/toolbarDock'

/**
 * Turns the inset desktop toolbar into full-width application chrome only
 * while it is pinned to the top of the editor scrollport. The class is toggled
 * imperatively so scrolling across the threshold does not re-render Toolbar.
 *
 * `is-docked` must only change paint, never layout — see the INVARIANT note in
 * toolbar.css. This listener reads the dock's own position, so a rule that
 * changes the dock's size when docked feeds straight back into scrollTop (via
 * scroll anchoring) and makes the class oscillate every frame.
 */
function ToolbarDock({ children, editorPanelRef, isTouchOnly }) {
  const dockRef = useRef(null)

  useEffect(() => {
    if (isTouchOnly) return undefined

    const panel = editorPanelRef?.current
    const dock = dockRef.current
    if (!panel || !dock) return undefined

    let rafId = null

    const updateDockedState = () => {
      rafId = null
      dock.classList.toggle(
        'is-docked',
        shouldDockToolbar({
          scrollTop: panel.scrollTop,
          dockTop: dock.getBoundingClientRect().top,
          panelTop: panel.getBoundingClientRect().top,
        }),
      )
    }

    // Coalesce to one layout read per frame. Scroll fires far more often than
    // the class can meaningfully change, and each run reads two rects.
    const schedule = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(updateDockedState)
    }

    updateDockedState()
    panel.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      panel.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [editorPanelRef, isTouchOnly])

  return (
    <div ref={dockRef} className="toolbar-dock">
      {children}
    </div>
  )
}

export default ToolbarDock
