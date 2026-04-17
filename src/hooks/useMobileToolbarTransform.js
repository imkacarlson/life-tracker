import { useEffect } from 'react'

/**
 * Pure formula that returns the CSS transform string needed to keep a
 * bottom-anchored toolbar above the on-screen virtual keyboard.
 *
 * Ported from BlockNote's ExperimentalMobileFormattingToolbarController:
 *   offsetTop = visualViewport.height - layoutHeight + visualViewport.offsetTop
 *
 * Intuition: the layout viewport stays full-screen; the visual viewport
 * shrinks when the keyboard opens. The delta between them is (the negative of)
 * the keyboard height. Translating the toolbar by that delta lifts it exactly
 * to the top of the keyboard. offsetLeft / offsetTop handle pinch-zoom pan;
 * inverse scale keeps the toolbar physically the same size during pinch-zoom.
 *
 * @param {{height: number, offsetTop: number, offsetLeft: number, scale: number}} viewport
 * @param {number} layoutHeight — document.documentElement.clientHeight
 * @returns {string} CSS transform value
 */
export function computeToolbarTransform(viewport, layoutHeight) {
  const offsetLeft = viewport.offsetLeft || 0
  const offsetTop = viewport.height - layoutHeight + (viewport.offsetTop || 0)
  const scale = viewport.scale ? 1 / viewport.scale : 1
  return `translate(${offsetLeft}px, ${offsetTop}px) scale(${scale})`
}

/**
 * Imperatively keep a bottom-fixed toolbar above the mobile virtual keyboard.
 *
 * Listens to visualViewport resize + scroll events and writes `transform`
 * to toolbarRef.current.style on the next animation frame. `transform` is a
 * compositor-only property, so updates do not trigger layout and do not fight
 * CSS transitions.
 *
 * No-ops when `enabled` is false (desktop / no visualViewport support).
 *
 * @param {{ enabled: boolean, toolbarRef: React.RefObject<HTMLElement> }} opts
 */
export function useMobileToolbarTransform({ enabled, toolbarRef }) {
  useEffect(() => {
    if (!enabled) return
    const viewport = window.visualViewport
    if (!viewport) return

    let rafId = null

    const apply = () => {
      rafId = null
      const toolbar = toolbarRef.current
      if (!toolbar) return
      const layoutHeight = document.documentElement.clientHeight
      toolbar.style.transform = computeToolbarTransform(viewport, layoutHeight)
    }

    const schedule = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(apply)
    }

    viewport.addEventListener('resize', schedule)
    viewport.addEventListener('scroll', schedule)
    schedule()

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      viewport.removeEventListener('resize', schedule)
      viewport.removeEventListener('scroll', schedule)
      const toolbar = toolbarRef.current
      if (toolbar) toolbar.style.transform = ''
    }
  }, [enabled, toolbarRef])
}
