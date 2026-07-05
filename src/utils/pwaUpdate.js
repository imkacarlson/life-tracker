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
