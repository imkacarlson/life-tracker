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
          <div className="brand-logo">
            <svg width="28" height="28" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="48" height="48" rx="10" fill="#0D9488"/>
              <path d="M12 28L20 20L26 26L36 16" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M30 16H36V22" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <h1>Life Tracker</h1>
          </div>
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
