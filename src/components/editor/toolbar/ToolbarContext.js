import { createContext, useContext } from 'react'

/**
 * Parent-owned values that individual toolbar tools need. Tools read from
 * context instead of having ~10 single-use props threaded through Toolbar.
 *
 * Shape:
 *   isTouchOnly:                bool — mobile / touch device flag
 *   hasTracker:                 bool — disables tools that need a doc
 *   controlsDisabled:           bool — broader disabled state
 *   editorPanelRef:             ref  — editor scroll container (for find scroll)
 *   title:                      str  — used for export filename + copy header
 *   onImageUpload:              fn   — invoked by the image tool
 *   onAiDailyGenerate:          fn   — invoked by the AI Daily tool
 *   showAiDaily:                bool — gates AI group visibility
 *   showAiInsert:               bool — gates the AI Insert button
 *   toolbarDeepLinkHash:        str  — for the More menu's copy-link
 *   isCurrentPageTracker:       bool — More menu label state
 *   trackerPageSaving:          bool — More menu label state
 *   onSetTrackerPage:           fn   — More menu enable predicate
 *   handleSetTrackerFromToolbar fn   — More menu action
 *   contextMenuItems:           arr  — extra in-table items for More menu
 *   openFind:                   fn   — provided by useFindBar
 */
export const ToolbarContext = createContext(null)

export function useToolbarContext() {
  const ctx = useContext(ToolbarContext)
  if (!ctx) {
    throw new Error('useToolbarContext must be used inside <ToolbarContext.Provider>')
  }
  return ctx
}
