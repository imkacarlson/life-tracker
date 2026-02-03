function SettingsHub({ onEditDailyTemplate, onBackToPages, loading }) {
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
        </div>
      )}
    </section>
  )
}

export default SettingsHub
