function EditorHeader({
  title,
  onTitleChange,
  onDelete,
  saveStatus,
  hasTracker,
  message,
  titleReadOnly,
  editorLocked,
  controlsDisabled,
  hasHeaderActions,
  headerActions,
  showDelete,
}) {
  return (
    <div className="editor-header">
      <div className="title-row">
        <input
          className="title-input"
          value={title}
          onChange={(event) => {
            if (titleReadOnly || editorLocked) return
            onTitleChange(event.target.value)
          }}
          placeholder="Tracker title"
          disabled={controlsDisabled}
          readOnly={titleReadOnly || editorLocked}
        />
        {hasHeaderActions && (
          <div className="title-actions">
            {headerActions}
            {showDelete && (
              <button className="ghost" onClick={onDelete} disabled={controlsDisabled}>
                Delete
              </button>
            )}
          </div>
        )}
      </div>
      <div className="status-row">
        <span className="subtle">{hasTracker ? saveStatus : 'No tracker selected'}</span>
        {editorLocked && hasTracker && <span className="subtle">Switching...</span>}
        {message && <span className="message-inline">{message}</span>}
      </div>
    </div>
  )
}

export default EditorHeader
