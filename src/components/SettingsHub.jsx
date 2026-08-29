function SettingsHub({
  onEditDailyTemplate,
  onBackToPages,
  loading,
  sportsScoresEnabled = true,
  onToggleSportsScores,
}) {
  return (
    <section className="settings-hub">
      <div className="settings-header">
        <div>
          <h2>Settings</h2>
          <p className="subtle">Manage app-wide preferences and templates.</p>
        </div>
        <button className="ghost" type="button" onClick={onBackToPages}>
          Back to Pages
        </button>
      </div>

      {loading ? (
        <div className="settings-loading">Loading settings...</div>
      ) : (
        <div className="settings-grid">
          <div className="settings-card">
            <div>
              <h3>Daily Template</h3>
              <p className="subtle">
                Static content that is prepended to the ASAP section of every AI Daily output.
              </p>
            </div>
            <button type="button" onClick={onEditDailyTemplate}>
              Edit Template
            </button>
          </div>

          <div className="settings-card">
            <div>
              <h3 id="sports-scores-label">Sports Score Alerts</h3>
              <p className="subtle">
                Emails a score summary when one of your teams finishes a game. Turning this off
                stops all checks; turning it back on retries immediately if checking had stopped
                itself.
              </p>
            </div>
            {/*
              role="switch" rather than the repo's aria-pressed: aria-pressed is
              for a transient mode (the find toolbar's AI pill), while a switch
              is the ARIA pattern for a persisted binary setting and announces
              "on/off" to match the visible label.
            */}
            <button
              type="button"
              role="switch"
              aria-checked={sportsScoresEnabled}
              aria-labelledby="sports-scores-label"
              className={`settings-toggle ${sportsScoresEnabled ? 'active' : ''}`}
              onClick={() => onToggleSportsScores?.(!sportsScoresEnabled)}
            >
              {sportsScoresEnabled ? 'On' : 'Off'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

export default SettingsHub
