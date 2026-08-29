// Should the sports-score check actually run this tick?
//
// The Settings toggle lives in `public.settings.sports_scores_enabled`. This
// module holds the tri-state decision so it can be unit-tested without a DB.
//
// HOUSE RULE: zero jsr:/npm:/https:// imports, zero top-level `Deno.*`.

export type ScoresRunDecision =
  | { run: true }
  | { run: false; reason: 'disabled' | 'settings_unavailable' }

export type SettingsRow = {
  sports_scores_enabled?: boolean | null
} | null | undefined

/**
 * Decide whether to run, from the result of
 *   .from('settings').select('sports_scores_enabled').limit(1).maybeSingle()
 *
 * Deliberate defaults:
 *  - A MISSING row means enabled. The column defaults to true, and deploying
 *    without ever opening the Settings UI must not silently kill notifications.
 *  - Only an explicit `false` disables. A null/undefined column (older row that
 *    predates the migration) is treated as enabled for the same reason.
 *  - A query error wins over whatever partial row came back: if we cannot read
 *    settings we also cannot dedupe or record results, so there is no point
 *    spending an ESPN request. That is reported distinctly from "disabled" so
 *    logs can tell a deliberate opt-out from a broken database.
 */
export function decideScoresRun(
  row: SettingsRow,
  error?: unknown,
): ScoresRunDecision {
  if (error) return { run: false, reason: 'settings_unavailable' }
  if (row?.sports_scores_enabled === false) {
    return { run: false, reason: 'disabled' }
  }
  return { run: true }
}
