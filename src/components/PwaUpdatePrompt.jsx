import { useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { shouldRunResume } from '../utils/resumeThrottle'
import { shouldCheckForUpdate } from '../utils/pwaUpdate'
import '../styles/pwa.css'

// Cadence for asking the browser "is there a newer service worker?".
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000 // hourly
// Returning to the foreground fires visibilitychange + online together; collapse
// that burst into a single check (same throttle useResumeRefresh uses).
const RESUME_MIN_INTERVAL_MS = 1500

/**
 * Surfaces a small, non-modal "New version available" banner when a new build
 * has been precached and is waiting to activate.
 *
 * The reload is user-triggered only: it happens exclusively on the Refresh
 * click, so whatever the user is typing is never touched until they choose to
 * refresh. Dismissing collapses the banner to a persistent pill rather than
 * hiding the update — it's always one click away.
 */
export default function PwaUpdatePrompt() {
  // Local "defer for later" state. `needRefresh` stays true; this only controls
  // whether we show the full banner or the compact pill.
  const [collapsed, setCollapsed] = useState(false)
  const lastResumeAtRef = useRef(null)

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, r) {
      if (!r) return

      // Ask the server for the SW script; if it changed, workbox installs the
      // new SW into the `waiting` state, which flips `needRefresh` -> true.
      const check = async () => {
        const guard = {
          hasRegistration: true,
          installing: !!r.installing,
          onLine: !('connection' in navigator) || navigator.onLine,
        }
        if (!shouldCheckForUpdate(guard)) return
        try {
          const resp = await fetch(swUrl, {
            cache: 'no-store',
            headers: { cache: 'no-store', 'cache-control': 'no-cache' },
          })
          if (resp?.status === 200) await r.update()
        } catch {
          // Network hiccup — the next interval / focus check will retry.
        }
      }

      setInterval(check, UPDATE_CHECK_INTERVAL_MS)

      // Also check on refocus / regained network so a tab reopened after days
      // updates promptly instead of waiting up to an hour.
      const onResume = () => {
        const now = Date.now()
        if (!shouldRunResume(lastResumeAtRef.current, now, RESUME_MIN_INTERVAL_MS)) return
        lastResumeAtRef.current = now
        check()
      }
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') onResume()
      })
      window.addEventListener('online', onResume)
    },
  })

  // Re-surface a deferred update the next time the tab is refocused: a gentle
  // reminder, never intrusive mid-edit.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && needRefresh) setCollapsed(false)
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [needRefresh])

  if (!needRefresh) return null

  const refresh = () => updateServiceWorker(true)

  if (collapsed) {
    return (
      <button
        type="button"
        className="pwa-update-pill"
        onClick={refresh}
        aria-label="Update ready — refresh to load the new version"
      >
        Update ready <span aria-hidden="true">⟳</span>
      </button>
    )
  }

  return (
    <div
      className="pwa-update-banner"
      role="status"
      aria-live="polite"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setCollapsed(true)
      }}
    >
      <span className="pwa-update-text">A new version is available.</span>
      <div className="pwa-update-actions">
        <button type="button" className="pwa-update-refresh" onClick={refresh}>
          Refresh
        </button>
        <button
          type="button"
          className="pwa-update-dismiss"
          onClick={() => setCollapsed(true)}
          aria-label="Dismiss for now"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>
  )
}
