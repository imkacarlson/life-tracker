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
  if (!contextMenu.open) return null

  return (
    <div
      ref={menuRef}
      className="table-context-menu"
      style={{ left: contextMenu.x, top: contextMenu.y }}
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
        <div
          className="table-context-parent"
          onMouseEnter={() => setSubmenuOpen(true)}
          onMouseLeave={() => setSubmenuOpen(false)}
        >
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
