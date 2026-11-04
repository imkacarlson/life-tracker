import { useEffect, useState } from 'react'
import { loadGlitchFlags, loadRecordedSessions, loadReplayEvents } from '../../lib/recordingLoader'
import ReplayPlayer from './ReplayPlayer'

// How much of the recording to show around a flag.
const FLAG_BEFORE_MS = 3 * 60_000
const FLAG_AFTER_MS = 60_000
// Where playback starts: shortly before the tap.
const FLAG_LEAD_IN_MS = 60_000

const formatWhen = (iso) =>
  new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

const formatDuration = (fromIso, toIso) => {
  const minutes = Math.max(1, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000))
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`
}

/**
 * Settings view listing glitch flags and recorded sessions, with a replay
 * player for either.
 */
function RecordingsPanel({ onBack }) {
  const [flags, setFlags] = useState([])
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // { title, events, startOffsetMs, truncated, trail } once a replay is open.
  const [replay, setReplay] = useState(null)
  const [replayLoading, setReplayLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([loadGlitchFlags(), loadRecordedSessions()])
      .then(([nextFlags, nextSessions]) => {
        if (cancelled) return
        setFlags(nextFlags)
        setSessions(nextSessions)
      })
      .catch((err) => !cancelled && setError(`Could not load recordings: ${err?.message ?? err}`))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const openReplay = async ({ title, sessionId, fromMs, toMs, focusMs, trail = null }) => {
    setReplayLoading(true)
    setError('')
    try {
      const { events, truncated } = await loadReplayEvents(sessionId, fromMs, toMs)
      if (events.length < 2) {
        setError('No screen recording exists for that moment (recording may have been off).')
        return
      }
      const startOffsetMs = focusMs ? Math.max(0, focusMs - events[0].timestamp) : 0
      setReplay({ title, events, startOffsetMs, truncated, trail })
    } catch (err) {
      setError(`Could not load the recording: ${err?.message ?? err}`)
    } finally {
      setReplayLoading(false)
    }
  }

  const openFlag = (flag) => {
    const flaggedMs = Date.parse(flag.flagged_at)
    openReplay({
      title: `Flag · ${formatWhen(flag.flagged_at)}${flag.note ? ` · ${flag.note}` : ''}`,
      sessionId: flag.session_id,
      fromMs: flaggedMs - FLAG_BEFORE_MS,
      toMs: flaggedMs + FLAG_AFTER_MS,
      focusMs: flaggedMs - FLAG_LEAD_IN_MS,
      trail: flag.recent_events,
    })
  }

  const openSession = (session) => {
    openReplay({
      title: `Session · ${formatWhen(session.startedAt)}`,
      sessionId: session.sessionId,
      fromMs: Date.parse(session.startedAt),
      toMs: Date.parse(session.endedAt),
    })
  }

  return (
    <section className="settings-hub recordings-panel">
      <div className="settings-header">
        <div>
          <h2>Flags &amp; Recordings</h2>
          <p className="subtle">Glitches you flagged and recorded sessions, newest first.</p>
        </div>
        <button className="ghost" type="button" onClick={replay ? () => setReplay(null) : onBack}>
          {replay ? 'Back to list' : 'Back to Settings'}
        </button>
      </div>

      {error ? <p className="recordings-error">{error}</p> : null}
      {replayLoading ? <p className="subtle">Loading recording…</p> : null}

      {replay ? (
        <div className="recordings-replay">
          <h3>{replay.title}</h3>
          {replay.truncated ? (
            <p className="subtle">Long session: showing the first 30 minutes.</p>
          ) : null}
          <ReplayPlayer events={replay.events} startOffsetMs={replay.startOffsetMs} />
          {replay.trail?.length ? (
            <details className="recordings-trail">
              <summary>Activity before the flag ({replay.trail.length} events)</summary>
              <ol>
                {replay.trail.map((event, index) => (
                  <li key={index}>
                    <span className="recordings-trail-time">
                      {new Date(event.occurred_at).toLocaleTimeString()}
                    </span>{' '}
                    {event.event_type}
                    {event.data && Object.keys(event.data).length ? (
                      <code>{JSON.stringify(event.data).slice(0, 160)}</code>
                    ) : null}
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </div>
      ) : loading ? (
        <div className="settings-loading">Loading…</div>
      ) : (
        <div className="settings-grid">
          <div className="settings-card recordings-list-card">
            <h3>Flags</h3>
            {flags.length === 0 ? (
              <p className="subtle">No flags yet. Tap the flag in the header when something looks off.</p>
            ) : (
              <ul className="recordings-list">
                {flags.map((flag) => (
                  <li key={flag.id}>
                    <button type="button" className="recordings-item" onClick={() => openFlag(flag)}>
                      <span className="recordings-item-title">{formatWhen(flag.flagged_at)}</span>
                      <span className="subtle">
                        {flag.device}
                        {flag.note ? ` · ${flag.note}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="settings-card recordings-list-card">
            <h3>Recorded sessions</h3>
            {sessions.length === 0 ? (
              <p className="subtle">No recordings yet.</p>
            ) : (
              <ul className="recordings-list">
                {sessions.map((session) => (
                  <li key={session.sessionId}>
                    <button
                      type="button"
                      className="recordings-item"
                      onClick={() => openSession(session)}
                    >
                      <span className="recordings-item-title">{formatWhen(session.startedAt)}</span>
                      <span className="subtle">
                        {session.device} · {formatDuration(session.startedAt, session.endedAt)} ·{' '}
                        {Math.max(1, Math.round(session.bytes / 1024))} KB
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

export default RecordingsPanel
