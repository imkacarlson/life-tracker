import { useState } from 'react'
import { addGlitchNote, flagGlitch } from '../../lib/activityLog'
import { flushRecording } from '../../lib/sessionRecorder'

/**
 * Header button for "something weird just happened". One tap saves the flag
 * (time, page, device, recent activity); the note box that opens afterwards is
 * optional, so dismissing it still keeps the flag.
 */
function GlitchFlagButton() {
  const [flag, setFlag] = useState(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleFlag = () => {
    setNote('')
    setError('')
    // The id is created locally, so the note can be attached even while the
    // flag is still uploading.
    setFlag(flagGlitch())
    // Upload the screen recording up to this moment right away, in case the
    // app is about to misbehave further.
    flushRecording()
  }

  const close = () => {
    setFlag(null)
    setNote('')
    setError('')
  }

  const handleSaveNote = async () => {
    if (!note.trim()) {
      close()
      return
    }
    setSaving(true)
    try {
      await addGlitchNote(flag.id, note)
      close()
    } catch {
      setError('Could not save the note. The flag itself was saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="ghost glitch-flag-button"
        aria-label="Flag a glitch"
        title="Flag a glitch"
        onClick={handleFlag}
      >
        <FlagIcon />
      </button>
      {flag ? (
        <div className="ai-insert-modal-backdrop" onClick={close}>
          <div
            className="ai-insert-modal glitch-flag-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="glitch-flag-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="glitch-flag-title">
              Flagged at {new Date(flag.flaggedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </h3>
            <p className="subtle">What happened? Optional — the flag is already saved.</p>
            <input
              type="text"
              className="glitch-flag-input"
              aria-label="Glitch note"
              placeholder="e.g. table jumped when I tapped it"
              value={note}
              maxLength={2000}
              autoFocus
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleSaveNote()
                if (event.key === 'Escape') close()
              }}
            />
            {error ? <p className="glitch-flag-error">{error}</p> : null}
            <div className="ai-insert-actions">
              <button type="button" className="ghost" onClick={close}>
                Skip
              </button>
              <button type="button" onClick={handleSaveNote} disabled={saving}>
                {saving ? 'Saving…' : 'Save note'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function FlagIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 21V4m0 0h11l-2 4 2 4H5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default GlitchFlagButton
