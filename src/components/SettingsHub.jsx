import { useState } from 'react'
import { useActivityRecordingEnabled } from '../hooks/useActivityRecordingEnabled'
import RecordingsPanel from './settings/RecordingsPanel'

function SettingsHub({
  onEditDailyTemplate,
  onBackToPages,
  loading,
  sportsScoresEnabled = true,
  onToggleSportsScores,
}) {
  const [recordingEnabled, setRecordingEnabled] = useActivityRecordingEnabled()
  const [showRecordings, setShowRecordings] = useState(false)

  if (showRecordings) return <RecordingsPanel onBack={() => setShowRecordings(false)} />

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

          <div className="settings-card">
            <div>
              <h3 id="activity-recording-label">Activity Recording</h3>
              <p className="subtle">
                Records how you use the app on this device (pages opened, edits, taps, keystrokes,
                errors, and a screen recording) to help debug glitches. Password fields are never
                recorded. The flag button still works when this is off.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={recordingEnabled}
              aria-labelledby="activity-recording-label"
              className={`settings-toggle ${recordingEnabled ? 'active' : ''}`}
              onClick={() => setRecordingEnabled(!recordingEnabled)}
            >
              {recordingEnabled ? 'On' : 'Off'}
            </button>
          </div>

          <div className="settings-card">
            <div>
              <h3>Flags &amp; Recordings</h3>
              <p className="subtle">
                Glitches you flagged and recorded sessions. Open one to watch it back.
              </p>
            </div>
            <button type="button" onClick={() => setShowRecordings(true)}>
              Open
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

export default SettingsHub
