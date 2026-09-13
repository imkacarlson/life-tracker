-- Durable, queryable record of every Gemini call check-scores makes.
--
-- Context: score emails have been arriving without their AI summary since
-- 2026-09-07. Two proposed root causes ("production is just slower", then "time
-- of day") were both derived from a handful of surviving log lines and both
-- collapsed under scrutiny. A temporary debug function made 10 grounded calls
-- from the same project, region and key — cold, after 8 ESPN fetches, after
-- json() parsing, on an aged worker, with the caller hung up — and all 10
-- answered in 4.9-8.7s, while every real failure shows Gemini unreachable for
-- 45-48 CONTINUOUS seconds. The failure cannot be reproduced synthetically.
--
-- The blocker is evidence, not analysis: edge logs age out, the log API only
-- queries 24-hour windows, and log text cannot be joined to the games table. So
-- one row per attempt, here, where a single SQL query can compare every failure
-- against every success.
--
-- Service-role only, like sports_check_health and sports_expected_games: RLS on
-- with NO policy denies everyone except the edge function.

create table if not exists public.gemini_call_log (
  id uuid primary key default gen_random_uuid(),

  -- `on delete set null`, NOT cascade, and deliberately so: score_history is
  -- purged at 7 days but these rows live 30, and cascade would quietly delete
  -- the evidence exactly when a run of failures became comparable.
  score_history_id uuid references public.score_history(id) on delete set null,
  -- Denormalized for the same reason — the row must stay readable after its
  -- game row is gone.
  team_name text not null,

  -- Groups every attempt made in one 15-minute tick.
  run_id text not null,
  attempt int not null,
  -- False only for the ungrounded diagnostic probe fired after a timeout.
  grounded boolean not null default true,

  outcome text not null check (
    outcome in ('answered', 'empty', 'http_error', 'timeout', 'network_error')
  ),
  status_code int,

  -- Time to response HEADERS vs total. fetch() resolves at headers; reading the
  -- body is a second wait. Null headers_ms means no response ever arrived,
  -- which separates "Google never answered" from "answered then stalled".
  headers_ms int,
  total_ms int not null,

  -- Seconds from the start of the run to the start of this attempt. Cheap to
  -- store and the one positional fact not recoverable from timestamps alone.
  secs_into_run numeric(6, 1),

  error_name text,
  error_detail text,

  created_at timestamptz not null default now()
);

alter table public.gemini_call_log enable row level security;
-- Service role only (the edge function). No end-user access is needed, and RLS
-- with no policy denies everyone else by default.

-- The 30-day purge in check-scores scans by age.
create index if not exists gemini_call_log_created_at_idx
  on public.gemini_call_log (created_at);

create index if not exists gemini_call_log_score_history_id_idx
  on public.gemini_call_log (score_history_id);
