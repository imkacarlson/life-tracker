/**
 * Pure helpers for useEditorSession state machine.
 * No React, no async — all inputs/outputs are plain JS values.
 */

/**
 * Returns the session mode based on settings state and navigation state.
 * @returns {'idle'|'template'|'settings'|'page'}
 */
export function computeSessionMode(settingsMode, activePageId) {
  if (settingsMode === 'daily-template') return 'template'
  if (settingsMode) return 'settings'
  if (activePageId) return 'page'
  return 'idle'
}

/**
 * Returns the synchronous session status — does not account for async hydration.
 * The hook upgrades 'pending-hydration' to 'ready' after hydration completes.
 * @returns {'idle'|'loading'|'pending-hydration'}
 */
export function computeSessionStatusSync(mode, activePage) {
  if (mode === 'idle' || mode === 'settings') return 'idle'
  if (mode === 'template') return 'pending-hydration'
  // mode === 'page'
  if (!activePage) return 'loading'
  // content === undefined means the page content cache hasn't loaded yet
  if (activePage.content === undefined) return 'loading'
  return 'pending-hydration'
}

/**
 * Derives a stable React key string for the editor session.
 * Changing this key unmounts and remounts the Tiptap editor with fresh content.
 */
export function computeSessionKey(mode, activePageId, nonce, activePage, settingsContentVersion) {
  if (mode === 'idle') return 'idle'
  if (mode === 'settings') return 'settings'
  if (mode === 'template') return `template:${settingsContentVersion ?? 0}`
  // mode === 'page'
  if (!activePage) return `loading:${activePageId}`
  // content === undefined means cache hasn't loaded yet — keep as loading key so
  // the editor mounts only after content is available (key change triggers remount)
  if (activePage.content === undefined) return `loading:${activePageId}`
  return `${activePageId}:${nonce}`
}
