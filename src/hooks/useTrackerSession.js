import { useState, useEffect, useRef, useCallback } from 'react'
import { normalizeContent } from '../utils/contentHelpers'
import {
  computeSessionMode,
  computeSessionStatusSync,
  computeSessionKey,
} from '../utils/trackerSessionHelpers'

/**
 * Manages the editor session lifecycle using Notesnook's pattern:
 * pre-load content before the editor mounts, gate on a 'ready' status,
 * and drive remounts via a stable sessionKey.
 *
 * Returns { session, sessionKey, bumpSessionNonce } where:
 *   session.status is 'idle' | 'loading' | 'ready'
 *   sessionKey changes on every page switch or forced refresh
 *   bumpSessionNonce() forces a remount without changing the page (e.g. conflict resolution)
 */
export function useTrackerSession({
  activeTrackerId,
  activeTracker,
  dataLoading,
  settingsMode,
  settingsContentVersion,
  templateContentRef,
  hydrateContentWithSignedUrls,
}) {
  const [nonce, setNonce] = useState(0)
  const [session, setSession] = useState({
    id: 'idle',
    trackerId: null,
    mode: 'idle',
    title: '',
    content: null,
    status: 'idle',
  })

  // Prevent re-hydrating the same session on every autosave (activeTracker changes
  // frequently as content is saved back). Only re-hydrate when session identity changes.
  const lastHydratedSessionKeyRef = useRef(null)
  // Cancel stale in-flight hydration when session changes before hydration completes.
  const hydrationRequestIdRef = useRef(0)

  const bumpSessionNonce = useCallback(() => {
    setNonce((n) => n + 1)
  }, [])

  useEffect(() => {
    const mode = computeSessionMode(settingsMode, activeTrackerId)
    const syncStatus = computeSessionStatusSync(mode, activeTracker, dataLoading)
    const sessionKey = computeSessionKey(mode, activeTrackerId, nonce, activeTracker, settingsContentVersion)

    if (syncStatus === 'idle') {
      lastHydratedSessionKeyRef.current = null
      setSession({
        id: sessionKey,
        trackerId: null,
        mode,
        title: '',
        content: null,
        status: 'idle',
      })
      return
    }

    if (syncStatus === 'loading') {
      setSession((prev) =>
        prev.status === 'loading' && prev.id === sessionKey
          ? prev
          : {
              id: sessionKey,
              trackerId: activeTrackerId,
              mode,
              title: '',
              content: null,
              status: 'loading',
            },
      )
      return
    }

    // syncStatus === 'pending-hydration'
    // Skip re-hydration for the same session key (avoids redundant work on autosave updates).
    if (lastHydratedSessionKeyRef.current === sessionKey) return

    const requestId = ++hydrationRequestIdRef.current
    let cancelled = false

    const hydrate = async () => {
      let rawContent
      if (mode === 'template') {
        rawContent = normalizeContent(templateContentRef?.current)
      } else {
        rawContent = normalizeContent(activeTracker?.content)
      }

      const hydratedContent = await hydrateContentWithSignedUrls(rawContent)

      if (cancelled || hydrationRequestIdRef.current !== requestId) return

      lastHydratedSessionKeyRef.current = sessionKey
      setSession({
        id: sessionKey,
        trackerId: mode === 'tracker' ? activeTrackerId : null,
        mode,
        title: activeTracker?.title ?? '',
        content: hydratedContent,
        status: 'ready',
      })
    }

    hydrate()

    return () => {
      cancelled = true
    }
  }, [
    activeTrackerId,
    activeTracker,
    dataLoading,
    settingsMode,
    settingsContentVersion,
    nonce,
    hydrateContentWithSignedUrls,
    templateContentRef,
  ])

  const mode = computeSessionMode(settingsMode, activeTrackerId)
  const sessionKey = computeSessionKey(mode, activeTrackerId, nonce, activeTracker, settingsContentVersion)

  return { session, sessionKey, bumpSessionNonce }
}
