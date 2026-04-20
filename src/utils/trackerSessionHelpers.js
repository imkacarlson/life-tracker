/**
 * Pure helpers for useTrackerSession state machine.
 * No React, no async — all inputs/outputs are plain JS values.
 */

/**
 * Returns the session mode based on settings state and navigation state.
 * @returns {'idle'|'template'|'settings'|'tracker'}
 */
export function computeSessionMode(settingsMode, activeTrackerId) {
  if (settingsMode === 'daily-template') return 'template'
  if (settingsMode) return 'settings'
  if (activeTrackerId) return 'tracker'
  return 'idle'
}

/**
 * Returns the synchronous session status — does not account for async hydration.
 * The hook upgrades 'pending-hydration' to 'ready' after hydration completes.
 * @returns {'idle'|'loading'|'pending-hydration'}
 */
export function computeSessionStatusSync(mode, activeTracker, _dataLoading) {
  if (mode === 'idle' || mode === 'settings') return 'idle'
  if (mode === 'template') return 'pending-hydration'
  // mode === 'tracker'
  if (!activeTracker) return 'loading'
  return 'pending-hydration'
}

/**
 * Derives a stable React key string for the editor session.
 * Changing this key unmounts and remounts the Tiptap editor with fresh content.
 */
export function computeSessionKey(mode, activeTrackerId, nonce, activeTracker, settingsContentVersion) {
  if (mode === 'idle') return 'idle'
  if (mode === 'settings') return 'settings'
  if (mode === 'template') return `template:${settingsContentVersion ?? 0}`
  // mode === 'tracker'
  if (!activeTracker) return `loading:${activeTrackerId}`
  return `${activeTrackerId}:${nonce}`
}
