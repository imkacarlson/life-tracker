import { useEffect, useRef } from 'react'
import { shouldRunResume } from '../utils/resumeThrottle'

const DEFAULT_MIN_INTERVAL_MS = 1500

/**
 * Fire `onResume` when the app returns to the foreground or regains network.
 *
 * Listens for:
 *   - visibilitychange -> visible (after being hidden): tab/app switch return
 *   - pageshow with event.persisted: bfcache restore (logic didn't re-run)
 *   - online: network came back
 *
 * Returning to the foreground often fires several of these at once; they
 * collapse into a single call via shouldRunResume (unit-tested separately).
 *
 * @param {() => void} onResume
 * @param {{ minIntervalMs?: number }} [options]
 */
export function useResumeRefresh(onResume, { minIntervalMs = DEFAULT_MIN_INTERVAL_MS } = {}) {
  const onResumeRef = useRef(onResume)
  useEffect(() => {
    onResumeRef.current = onResume
  }, [onResume])

  const lastRunAtRef = useRef(null)

  useEffect(() => {
    const trigger = () => {
      const now = Date.now()
      if (!shouldRunResume(lastRunAtRef.current, now, minIntervalMs)) return
      lastRunAtRef.current = now
      onResumeRef.current?.()
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') trigger()
    }
    // Only bfcache restores need this — a fresh load runs the normal data path.
    const handlePageShow = (event) => {
      if (event.persisted) trigger()
    }
    const handleOnline = () => {
      trigger()
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pageshow', handlePageShow)
    window.addEventListener('online', handleOnline)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pageshow', handlePageShow)
      window.removeEventListener('online', handleOnline)
    }
  }, [minIntervalMs])
}
