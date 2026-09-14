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

/** Inputs to the "is this game ready to email?" decision. */
export type SendDecisionInput = {
  /** Did we manage to generate (or reuse) an AI summary? */
  hasSummary: boolean
  /** How long ago the result was recorded, from score_history.created_at. */
  ageMs: number
  /** How long a game may wait for its summary before the email goes anyway. */
  holdMs: number
}

/**
 * Send the email now, or hold this game for one more summary attempt later?
 *
 * The summary gets exactly one shot today, in the ~60s before the email is sent,
 * and gemini-2.5-flash currently hangs often enough that the shot usually misses
 * (see googleapis/python-genai#1893 — sockets stall instead of returning 503).
 * Once the email is out the blurb is lost for that game forever. Holding briefly
 * buys a second attempt minutes later, which is the spacing an intermittent
 * upstream actually responds to.
 *
 * Load-bearing property: the decision is derived from the row's AGE, not from a
 * retry counter. So it is stateless, and it self-limits — if the pending-games
 * pass breaks completely, the next run sees an old row and sends it. The email
 * always goes out; at worst it is `holdMs` late. That is the 2026-09-05
 * guarantee and it must not be weakened into "the email waits for Gemini".
 */
export function decideSendAction(input: SendDecisionInput): 'send' | 'hold' {
  if (input.hasSummary) return 'send'
  // >= rather than >: a holdMs of 0 must mean "never hold", so the behavior can
  // be switched off by configuration alone.
  if (input.ageMs >= input.holdMs) return 'send'
  return 'hold'
}
