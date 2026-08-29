-- Health/circuit-breaker state and adaptive polling state for check-scores.
--
-- Context: ESPN began returning 403 on 2026-08-05 and the function swallowed it
-- ("no games today") for three weeks. These tables make a failure durable and
-- visible across the stateless function's runs.

-- One row, keyed by upstream name, holding the breaker state.
create table if not exists public.sports_check_health (
  id text primary key default 'espn',
  state text not null default 'healthy' check (state in ('healthy', 'degraded', 'blocked')),
  consecutive_failures integer not null default 0,
  -- Rung of the 1h → 2h → 4h → 8h → 24h ladder.
  backoff_level integer not null default 0,
  backoff_until timestamptz,
  -- Last HTTP status seen from ESPN; null when the request threw outright.
  last_status integer,
  last_success_at timestamptz,
  -- Whether the Settings toggle was on the last time we looked. The ONLY thing
  -- written while the feature is disabled, and only on the transition — it is
  -- what lets an off→on flip in the UI clear a tripped breaker ("try again now")
  -- without giving the browser write access to this table.
  last_seen_enabled boolean not null default true,
  last_alert_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.sports_check_health (id) values ('espn')
  on conflict (id) do nothing;

alter table public.sports_check_health enable row level security;
-- Service role only (the edge function). No end-user access is needed, and RLS
-- with no policy denies everyone else by default.

-- Games we have SEEN scheduled or in progress. The stale-data alert reads from
-- here rather than from the live response — on 2026-08-05 the response was a
-- clean 200 with nothing in it, so anything derived from the payload would also
-- have seen nothing wrong.
create table if not exists public.sports_expected_games (
  team_id uuid not null references public.sport_teams(id) on delete cascade,
  espn_game_id text not null,
  start_time timestamptz not null,
  alerted_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (team_id, espn_game_id)
);

alter table public.sports_expected_games enable row level security;
-- Service role only, same as above.

-- When this team is next worth asking ESPN about. Null means "ask now", so
-- existing rows keep working on the first run after deploy.
alter table public.sport_teams
  add column if not exists next_poll_at timestamptz;

create index if not exists sport_teams_next_poll_at_idx
  on public.sport_teams (next_poll_at)
  where active;
