export const DEFAULT_SIDEBAR_WIDTH = 280
export const MIN_SIDEBAR_WIDTH = 220
export const MIN_EDITOR_WIDTH = 520
export const SIDEBAR_RESIZER_WIDTH = 14
export const SIDEBAR_BADGE_COMPACT_WIDTH = 300
export const MOBILE_BREAKPOINT_PX = 900

export const clampSidebarWidth = (width, workspaceWidth) => {
  const maxSidebarWidth = Math.max(
    MIN_SIDEBAR_WIDTH,
    workspaceWidth - SIDEBAR_RESIZER_WIDTH - MIN_EDITOR_WIDTH,
  )
  return Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), maxSidebarWidth)
}

export const getWorkspaceContentWidth = (workspaceElement) => {
  const computed = window.getComputedStyle(workspaceElement)
  const paddingLeft = Number.parseFloat(computed.paddingLeft) || 0
  const paddingRight = Number.parseFloat(computed.paddingRight) || 0
  return Math.max(0, workspaceElement.clientWidth - paddingLeft - paddingRight)
}
