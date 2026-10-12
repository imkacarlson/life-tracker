import { useCallback, useEffect, useRef } from 'react'

// How long the pointer can rest on another main-menu item before the Table
// submenu closes. Gives a diagonal path toward the submenu time to arrive.
const SUBMENU_CLOSE_DELAY_MS = 300

export default function EditorContextMenu({
  menuRef,
  submenuRef,
  contextMenu,
  spellSuggestions,
  deepLinkHash,
  hasEditorTarget,
  isCurrentDailySourcePage,
  dailySourceSaving,
  onSetDailySourcePage,
  submenuOpen,
  submenuDirection,
  contextMenuItems,
  setSubmenuOpen,
  closeContextMenu,
  handleApplySuggestion,
  handleAddToDictionary,
  handleIgnoreWord,
  handleCopyLink,
  handleSetDailySourceFromMenu,
}) {
  const tableParentRef = useRef(null)
  const closeTimerRef = useRef(null)

  const cancelSubmenuClose = useCallback(() => {
    clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])

  useEffect(() => cancelSubmenuClose, [cancelSubmenuClose])

  // Like native menus: leaving the menu (e.g. cutting across table cells on
  // the way to the submenu) keeps the submenu open. It only closes after the
  // pointer settles on a different main-menu item.
  const handleMenuMouseOver = useCallback(
    (event) => {
      if (tableParentRef.current?.contains(event.target)) {
        cancelSubmenuClose()
        setSubmenuOpen(true)
        return
      }
      if (!submenuOpen || closeTimerRef.current) return
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null
        setSubmenuOpen(false)
      }, SUBMENU_CLOSE_DELAY_MS)
    },
    [submenuOpen, setSubmenuOpen, cancelSubmenuClose],
  )

  if (!contextMenu.open) return null

  return (
    <div
      ref={menuRef}
      className="table-context-menu"
      style={{ left: contextMenu.x, top: contextMenu.y }}
      onMouseOver={handleMenuMouseOver}
    >
      {contextMenu.misspelling && (
        <>
          {spellSuggestions.length > 0 ? (
            spellSuggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="table-context-item spellcheck-suggestion"
                onClick={() => handleApplySuggestion(suggestion)}
              >
                {suggestion}
              </button>
            ))
          ) : (
            <span className="table-context-item disabled">No suggestions</span>
          )}
          <button type="button" className="table-context-item" onClick={handleAddToDictionary}>
            Add to dictionary
          </button>
          <button type="button" className="table-context-item" onClick={handleIgnoreWord}>
            Ignore
          </button>
          <div className="table-context-divider" />
        </>
      )}
      <button
        type="button"
        className={`table-context-item ${!deepLinkHash ? 'disabled' : ''}`}
        onClick={handleCopyLink}
        disabled={!deepLinkHash}
      >
        Copy link to paragraph
      </button>
      <button
        type="button"
        className={`table-context-item ${isCurrentDailySourcePage || dailySourceSaving ? 'disabled' : ''}`}
        onClick={handleSetDailySourceFromMenu}
        disabled={!hasEditorTarget || isCurrentDailySourcePage || dailySourceSaving || !onSetDailySourcePage}
      >
        {isCurrentDailySourcePage
          ? 'This page is the tracker page'
          : dailySourceSaving
            ? 'Setting tracker page...'
            : 'Set this page as tracker'}
      </button>
      {contextMenu.inTable && (
        <div ref={tableParentRef} className="table-context-parent">
          <button
            type="button"
            className="table-context-item"
            onClick={() => setSubmenuOpen((prev) => !prev)}
          >
            Table
          </button>
          {submenuOpen && (
            <div
              ref={submenuRef}
              className={`table-submenu ${submenuDirection === 'left' ? 'left' : 'right'}`}
            >
              {contextMenuItems.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className="table-context-item"
                  onClick={() => {
                    item.action()
                    closeContextMenu()
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
