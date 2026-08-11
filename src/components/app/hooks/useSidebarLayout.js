import { useCallback, useEffect, useRef, useState } from 'react'
import {
  readStoredSidebarCollapsed,
  readStoredSidebarWidth,
  saveStoredSidebarCollapsed,
  saveStoredSidebarWidth,
} from '../../../utils/storage'
import {
  DEFAULT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  MOBILE_BREAKPOINT_PX,
  SIDEBAR_BADGE_COMPACT_WIDTH,
  clampSidebarWidth,
  getWorkspaceContentWidth,
} from '../sidebarLayout'

export function useSidebarLayout() {
  const workspaceRef = useRef(null)
  const resizeStateRef = useRef(null)
  const sidebarWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH)
  const [isMobileViewport, setIsMobileViewport] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT_PX,
  )
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readStoredSidebarWidth(DEFAULT_SIDEBAR_WIDTH),
  )
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    readStoredSidebarCollapsed(false),
  )
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [isResizingSidebar, setIsResizingSidebar] = useState(false)

  const clampSidebarWidthForWorkspace = useCallback((nextWidth) => {
    const workspaceElement = workspaceRef.current
    if (!workspaceElement) return Math.max(nextWidth, MIN_SIDEBAR_WIDTH)
    return clampSidebarWidth(nextWidth, getWorkspaceContentWidth(workspaceElement))
  }, [])

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth
  }, [sidebarWidth])

  useEffect(() => {
    const syncViewport = () => {
      setIsMobileViewport(window.innerWidth <= MOBILE_BREAKPOINT_PX)
    }
    syncViewport()
    window.addEventListener('resize', syncViewport)
    return () => window.removeEventListener('resize', syncViewport)
  }, [])

  useEffect(() => {
    const syncSidebarWidth = () => {
      setSidebarWidth((previous) => clampSidebarWidthForWorkspace(previous))
    }
    syncSidebarWidth()
    window.addEventListener('resize', syncSidebarWidth)
    return () => window.removeEventListener('resize', syncSidebarWidth)
  }, [clampSidebarWidthForWorkspace])

  useEffect(() => {
    if (!isMobileViewport) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- desktop mode always closes the mobile-only drawer.
      setMobileSidebarOpen(false)
    }
  }, [isMobileViewport])

  useEffect(() => {
    if (!isMobileViewport) return undefined
    const handleHashChange = () => setMobileSidebarOpen(false)
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [isMobileViewport])

  const handleToggleSidebar = useCallback(() => {
    if (isMobileViewport) {
      setMobileSidebarOpen((previous) => !previous)
      return
    }

    setSidebarCollapsed((previous) => {
      const next = !previous
      saveStoredSidebarCollapsed(next)
      return next
    })
  }, [isMobileViewport])

  const handleSidebarResizeStart = useCallback(
    (event) => {
      if (isMobileViewport || sidebarCollapsed) return
      if (typeof event.button === 'number' && event.button !== 0) return
      const workspaceElement = workspaceRef.current
      if (!workspaceElement) return

      event.preventDefault()
      resizeStateRef.current = {
        startX: event.clientX,
        startWidth: sidebarWidthRef.current,
      }
      setIsResizingSidebar(true)
    },
    [isMobileViewport, sidebarCollapsed],
  )

  const handleSidebarResizeKeyDown = useCallback(
    (event) => {
      if (isMobileViewport || sidebarCollapsed) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      const delta = event.key === 'ArrowRight' ? 24 : -24
      setSidebarWidth((previous) => {
        const next = clampSidebarWidthForWorkspace(previous + delta)
        saveStoredSidebarWidth(next)
        return next
      })
    },
    [clampSidebarWidthForWorkspace, isMobileViewport, sidebarCollapsed],
  )

  useEffect(() => {
    if (!isResizingSidebar) return

    const handlePointerMove = (event) => {
      const resizeState = resizeStateRef.current
      if (!resizeState) return
      const deltaX = event.clientX - resizeState.startX
      setSidebarWidth(clampSidebarWidthForWorkspace(resizeState.startWidth + deltaX))
    }

    const stopResizing = () => {
      resizeStateRef.current = null
      setIsResizingSidebar(false)
      saveStoredSidebarWidth(sidebarWidthRef.current)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)
    window.addEventListener('pointercancel', stopResizing)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
      window.removeEventListener('pointercancel', stopResizing)
    }
  }, [isResizingSidebar, clampSidebarWidthForWorkspace])

  const isSidebarOpen = isMobileViewport ? mobileSidebarOpen : !sidebarCollapsed
  const workspaceClassName = [
    'workspace',
    !isMobileViewport && sidebarCollapsed ? 'sidebar-collapsed' : '',
    isResizingSidebar ? 'sidebar-resizing' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return {
    workspaceRef,
    isMobileViewport,
    sidebarCollapsed,
    mobileSidebarOpen,
    setMobileSidebarOpen,
    isSidebarOpen,
    compactBadges: sidebarWidth < SIDEBAR_BADGE_COMPACT_WIDTH,
    workspaceClassName,
    workspaceStyle: { '--sidebar-width': `${sidebarWidth}px` },
    handleToggleSidebar,
    handleSidebarResizeStart,
    handleSidebarResizeKeyDown,
  }
}
