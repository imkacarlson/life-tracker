function WelcomeScreen({ session, onCreateNotebook, onSignOut }) {
  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Life Tracker</h1>
          <p className="subtle">Signed in as {session.user.email}</p>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className="ghost settings-button"
            disabled
          >
            Settings
          </button>
          <button className="secondary" onClick={onSignOut}>
            Log out
          </button>
        </div>
      </header>
      <div className="welcome">
        <div className="card">
          <h2>Create your first notebook</h2>
          <p className="subtle">
            Notebooks group your trackers. Create one to start organizing your sections and pages.
          </p>
          <button onClick={onCreateNotebook}>New notebook</button>
        </div>
      </div>
    </div>
  )
}

export default WelcomeScreen
