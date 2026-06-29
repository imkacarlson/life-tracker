export const EMPTY_DOC = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
}

export const STORAGE_KEY = 'life-tracker:lastSelection'
export const SIDEBAR_WIDTH_STORAGE_KEY = 'life-tracker:sidebarWidth'
export const SIDEBAR_COLLAPSED_KEY = 'life-tracker:sidebarCollapsed'

// Per-page scroll positions, session-scoped (sessionStorage) so they survive a
// reload within the same tab but don't accumulate across sessions.
export const SCROLL_POSITIONS_KEY = 'life-tracker:scrollPositions'
// Keep only the most-recent N pages' scroll offsets so the store stays small.
export const MAX_SCROLL_POSITIONS = 50

// Last-used toolbar color tools, persisted across sessions.
export const HIGHLIGHT_COLOR_KEY = 'life-tracker:highlightColor'
export const TEXT_COLOR_KEY = 'life-tracker:textColor'
export const SHADING_COLOR_KEY = 'life-tracker:shadingColor'

export const COLOR_PALETTE = ['#e0f2fe', '#ede9fe', '#fce7f3', '#fef9c3', '#dcfce7', '#ffe4e6']
