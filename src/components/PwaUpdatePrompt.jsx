import { useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { shouldRunResume } from '../utils/resumeThrottle'
import {
  shouldCheckForUpdate,
  resolveRefreshAction,
  isUpdateBannerStale,
} from '../utils/pwaUpdate'
import { beginIntentionalReload } from '../utils/reloadCoordinator'
import '../styles/pwa.css'

// Cadence for asking the browser "is there a newer service worker?".
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000 // hourly
// Returning to the foreground fires visibilitychange + online together; collapse
// that burst into a single check (same throttle useResumeRefresh uses).
const RESUME_MIN_INTERVAL_MS = 1500
// If skipWaiting doesn't produce a reload in this long, reload ourselves. Covers
// a missed `controlling` event or an activation that raced ahead of the click.
const RELOAD_FALLBACK_MS = 2000

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
  // A Refresh is in flight — the button reads as busy and can't be double-fired.
  const [refreshing, setRefreshing] = useState(false)
  // The banner turned out to be advertising an update that already landed.
  const [staleDismissed, setStaleDismissed] = useState(false)
  const lastResumeAtRef = useRef(null)
  // The live registration. `onRegisteredSW`'s `r` is otherwise trapped in that
  // closure, and refresh() needs to inspect `waiting` to decide what to do.
  const registrationRef = useRef(null)

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, r) {
      if (!r) return
      registrationRef.current = r

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

  // On refocus: re-surface a deferred update (a gentle reminder, never
  // intrusive mid-edit) and re-validate the banner against reality —
  // `needRefresh` is never lowered by vite-plugin-pwa once raised, so a worker
  // that activated on its own would otherwise leave a phantom banner forever.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible' || !needRefresh) return
      setCollapsed(false)
      const r = registrationRef.current
      // Recomputed (not latched) so a genuinely new update un-dismisses itself.
      setStaleDismissed(
        isUpdateBannerStale({
          hasWaiting: !!r?.waiting,
          hasInstalling: !!r?.installing,
          isControlled: !!navigator.serviceWorker?.controller,
        }),
      )
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [needRefresh])

  if (!needRefresh || staleDismissed) return null

  const refresh = () => {
    if (refreshing) return
    setRefreshing(true)

    // Flush pending saves and tell App's beforeunload guard that this unload is
    // wanted — otherwise it can raise "Leave site?" and cancelling it strands
    // the page on the old build with a dead banner.
    beginIntentionalReload()

    const action = resolveRefreshAction({ hasWaiting: !!registrationRef.current?.waiting })
    if (action === 'reload') {
      // Nothing waiting: the new build already activated, so just reload into it.
      window.location.reload()
      return
    }

    updateServiceWorker(true)
    // Belt and braces: the reload above is only a side effect of the
    // `controlling` event. If that never lands, do it ourselves.
    setTimeout(() => window.location.reload(), RELOAD_FALLBACK_MS)
  }

  if (collapsed) {
    return (
      <button
        type="button"
        className="pwa-update-pill"
        onClick={refresh}
        disabled={refreshing}
        aria-label="Update ready — refresh to load the new version"
      >
        {refreshing ? 'Refreshing…' : 'Update ready'} <span aria-hidden="true">⟳</span>
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
        <button
          type="button"
          className="pwa-update-refresh"
          onClick={refresh}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
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
