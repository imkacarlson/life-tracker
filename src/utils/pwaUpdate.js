/**
 * Decide whether a service-worker update check should run right now.
 *
 * Pure on purpose so the guard can be unit-tested without a real
 * ServiceWorkerRegistration or network — the fetch/`r.update()` wiring lives in
 * PwaUpdatePrompt.jsx.
 *
 * Skips when:
 *   - there is no registration yet (nothing to update), or
 *   - a new SW is already installing (a check is effectively in flight), or
 *   - the browser reports itself offline (the no-store fetch would just fail).
 *
 * @param {{ hasRegistration: boolean, installing: boolean, onLine: boolean }} state
 * @returns {boolean}
 */
export function shouldCheckForUpdate({ hasRegistration, installing, onLine }) {
  if (!hasRegistration) return false
  if (installing) return false
  if (!onLine) return false
  return true
}

/**
 * Decide what a Refresh click should actually do.
 *
 * `updateServiceWorker(true)` only messages the *waiting* worker to skip
 * waiting; the reload is a side effect of the resulting `controlling` event.
 * If nothing is waiting (the worker already activated on its own, or an
 * earlier reload was cancelled) that call is a silent no-op and the button
 * appears dead. In that case the new build is already precached, so a plain
 * reload is both correct and sufficient.
 *
 * @param {{ hasWaiting: boolean }} state
 * @returns {'skip-waiting' | 'reload'}
 */
export function resolveRefreshAction({ hasWaiting }) {
  return hasWaiting ? 'skip-waiting' : 'reload'
}

/**
 * Is the update banner advertising an update that has already landed?
 *
 * vite-plugin-pwa never re-validates `needRefresh` against the registration,
 * so it can stay true forever after the waiting worker activates without us.
 * That's stale only when there is genuinely nothing left to activate:
 * nothing waiting, nothing installing, and the page is already controlled by
 * an active worker.
 *
 * @param {{ hasWaiting: boolean, hasInstalling: boolean, isControlled: boolean }} state
 * @returns {boolean}
 */
export function isUpdateBannerStale({ hasWaiting, hasInstalling, isControlled }) {
  if (hasWaiting) return false
  if (hasInstalling) return false
  if (!isControlled) return false
  return true
}
