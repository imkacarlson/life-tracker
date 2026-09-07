// "We already have a row for this game — did we ever actually email it?"
//
// The unique constraint on (team_id, espn_game_id) is what stops a game being
// emailed twice, but the insert commits well before the email is sent. On
// 2026-09-05 the worker died in that gap and every later run read the 23505 as
// "already notified", so the result was never sent. Splitting the decision out
// here keeps it testable — index.ts imports jsr: and Vitest cannot load it.
//
// HOUSE RULE: zero jsr:/npm:/https:// imports, zero top-level `Deno.*`.

/** The columns we read back after a unique-violation on insert. */
export type ExistingScoreRow = {
  id: string
  notified_at: string | null
  ai_summary: string | null
}

export type NotifyAction =
  /** Already emailed — nothing to do. */
  | { action: 'skip' }
  /** Recorded but never emailed: finish the job against the existing row. */
  | { action: 'retry'; scoreHistoryId: string; reuseSummary: string | null }

/**
 * What to do about a game that is already in score_history.
 *
 * A null `existing` means the row vanished between the failed insert and the
 * read (a retention purge racing us). Treat that as 'skip': re-inserting would
 * re-notify a game old enough to have been purged.
 */
export function decideNotifyAction(existing: ExistingScoreRow | null | undefined): NotifyAction {
  if (!existing) return { action: 'skip' }
  if (existing.notified_at) return { action: 'skip' }
  return {
    action: 'retry',
    scoreHistoryId: existing.id,
    // A summary generated on the earlier run is still good — don't spend
    // another Gemini call (or another slice of the run budget) on it.
    reuseSummary: existing.ai_summary ?? null,
  }
}
