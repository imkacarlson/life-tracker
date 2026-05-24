/**
 * Decide whether a resume signal should trigger work.
 *
 * Returning to the foreground often fires several events at once
 * (`visibilitychange`, `pageshow`, `online`). This collapses such a burst into
 * a single trigger: work runs only if it has not run within `minIntervalMs`.
 *
 * Pure on purpose so the throttle decision can be unit-tested without timers —
 * see useResumeRefresh.js for the event wiring.
 *
 * @param {number|null} lastRunAt    Timestamp of the last run, or null if never.
 * @param {number} now               Current timestamp.
 * @param {number} minIntervalMs     Minimum gap between runs.
 * @returns {boolean}
 */
export function shouldRunResume(lastRunAt, now, minIntervalMs) {
  if (lastRunAt == null) return true
  return now - lastRunAt >= minIntervalMs
}
