-- Make the score email survive a crash between "result recorded" and "email sent".
--
-- Context: on 2026-09-05 Gemini returned 503 three times, each hanging ~45s. The
-- worker was killed at the 150s wall-clock limit AFTER the score_history insert
-- committed but BEFORE sendEmail ran. Because the insert itself was the dedupe
-- token (23505 == "already notified"), every later run skipped the game and the
-- Indiana result was never emailed.
--
-- `notified_at` splits those two facts apart: the row records that we SAW the
-- game, the timestamp records that we EMAILED it. Only a confirmed send sets it,
-- so a crash in between is retried on the next tick instead of tombstoned.

alter table public.score_history
  add column if not exists notified_at timestamptz,
  -- Mirrors sports_expected_games.alerted_at: stamps the "recorded but never
  -- emailed" alert so it fires once rather than every 15 minutes.
  add column if not exists notify_alerted_at timestamptz;

-- Backfill every existing row as already notified. This fix is forward-looking:
-- historical results (including the 2026-09-05 Indiana game this bug swallowed)
-- must not be resent days late.
update public.score_history set notified_at = created_at where notified_at is null;

create index if not exists score_history_unnotified_idx
  on public.score_history (created_at)
  where notified_at is null;
