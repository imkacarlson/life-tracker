import { useEffect, useRef } from 'react'

/**
 * Turns the inset desktop toolbar into full-width application chrome only
 * while it is pinned to the top of the editor scrollport. The class is toggled
 * imperatively so scrolling across the threshold does not re-render Toolbar.
 */
function ToolbarDock({ children, editorPanelRef, isTouchOnly }) {
  const dockRef = useRef(null)

  useEffect(() => {
    if (isTouchOnly) return undefined

    const panel = editorPanelRef?.current
    const dock = dockRef.current
    if (!panel || !dock) return undefined

    const updateDockedState = () => {
      const panelTop = panel.getBoundingClientRect().top
      const dockTop = dock.getBoundingClientRect().top
      const isDocked = panel.scrollTop > 0 && dockTop <= panelTop + 1
      dock.classList.toggle('is-docked', isDocked)
    }

    updateDockedState()
    panel.addEventListener('scroll', updateDockedState, { passive: true })
    window.addEventListener('resize', updateDockedState)

    return () => {
      panel.removeEventListener('scroll', updateDockedState)
      window.removeEventListener('resize', updateDockedState)
    }
  }, [editorPanelRef, isTouchOnly])

  return (
    <div ref={dockRef} className="toolbar-dock">
      {children}
    </div>
  )
}

export default ToolbarDock
