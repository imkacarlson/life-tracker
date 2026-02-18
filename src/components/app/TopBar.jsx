function TopBar({
  session,
  notebooks,
  activeNotebookId,
  activeNotebook,
  settingsMode,
  onNotebookChange,
  onCreateNotebook,
  onRenameNotebook,
  onDeleteNotebook,
  onOpenSettings,
  onSignOut,
}) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand">
          <h1>Life Tracker</h1>
          <p className="subtle">Signed in as {session.user.email}</p>
        </div>
        <div className="notebook-switcher">
          <label className="subtle">Notebook</label>
          <select value={activeNotebookId ?? ''} onChange={(event) => onNotebookChange(event.target.value)}>
            {notebooks.map((notebook) => (
              <option key={notebook.id} value={notebook.id}>
                {notebook.title}
              </option>
            ))}
          </select>
          <button className="ghost" onClick={onCreateNotebook}>
            New
          </button>
          <button className="ghost" onClick={onRenameNotebook} disabled={!activeNotebook}>
            Rename
          </button>
          <button className="ghost" onClick={onDeleteNotebook} disabled={!activeNotebook}>
            Delete
          </button>
        </div>
      </div>
      <div className="topbar-actions">
        <button
          type="button"
          className={`ghost settings-button ${settingsMode ? 'active' : ''}`}
          onClick={onOpenSettings}
        >
          Settings
        </button>
        <button className="secondary" onClick={onSignOut}>
          Log out
        </button>
      </div>
    </header>
  )
}

export default TopBar
