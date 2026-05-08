function MoreMenu({
  onClose,
  onCopyLink,
  copyLinkDisabled,
  onSetTrackerPage,
  setTrackerLabel,
  setTrackerDisabled,
  inTable,
  contextMenuItems,
}) {
  return (
    <>
      <div className="more-menu-backdrop" onClick={onClose} />
      <div className="more-menu">
        <button
          type="button"
          className="table-context-item"
          onClick={onCopyLink}
          disabled={copyLinkDisabled}
        >
          Copy link to paragraph
        </button>
        <button
          type="button"
          className="table-context-item"
          onClick={onSetTrackerPage}
          disabled={setTrackerDisabled}
        >
          {setTrackerLabel}
        </button>
        {inTable && contextMenuItems?.length > 0 && (
          <>
            <div className="more-menu-divider" />
            {contextMenuItems.map((item) => (
              <button
                key={item.label}
                type="button"
                className="table-context-item"
                onClick={() => { item.action(); onClose() }}
              >
                {item.label}
              </button>
            ))}
          </>
        )}
      </div>
    </>
  )
}

export default MoreMenu
