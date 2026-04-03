-- Sport teams config table
create table public.sport_teams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  name text not null,
  display_name text not null,
  sport text not null,
  league text not null,
  espn_team_id text not null,
  emoji_win text not null default '',
  emoji_loss text not null default '',
  emoji_tie text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sport_teams enable row level security;

create policy "Users can read their sport_teams"
  on public.sport_teams for select using (auth.uid() = user_id);
create policy "Users can insert their sport_teams"
  on public.sport_teams for insert with check (auth.uid() = user_id);
create policy "Users can update their sport_teams"
  on public.sport_teams for update using (auth.uid() = user_id);
create policy "Users can delete their sport_teams"
  on public.sport_teams for delete using (auth.uid() = user_id);

-- Score history — one row per completed game per team
create table public.score_history (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.sport_teams(id) on delete cascade,
  espn_game_id text not null,
  game_date date not null,
  team_score integer not null,
  opponent_name text not null,
  opponent_score integer not null,
  result text not null check (result in ('win', 'loss', 'tie')),
  home_away text not null check (home_away in ('home', 'away')),
  ai_summary text,
  raw_espn_data jsonb,
  created_at timestamptz not null default now(),
  constraint unique_team_game unique (team_id, espn_game_id)
);

alter table public.score_history enable row level security;

create policy "Users can read their score_history"
  on public.score_history for select
  using (exists (
    select 1 from public.sport_teams st
    where st.id = score_history.team_id and st.user_id = auth.uid()
  ));

-- Service role inserts (from edge function), no user insert policy needed

-- Notification log — tracks email send attempts
create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  score_history_id uuid references public.score_history(id) on delete set null,
  channel text not null default 'email',
  recipient text not null,
  subject text not null,
  status text not null check (status in ('sent', 'failed', 'skipped')),
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.notification_log enable row level security;

create policy "Users can read their notification_log"
  on public.notification_log for select
  using (exists (
    select 1 from public.score_history sh
    join public.sport_teams st on st.id = sh.team_id
    where sh.id = notification_log.score_history_id and st.user_id = auth.uid()
  ));
