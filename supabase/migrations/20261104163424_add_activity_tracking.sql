-- Activity tracking: a durable record of how the app is used, plus glitch
-- flags the user taps when something looks wrong.
--
-- Two goals:
--   1. Raw material for later brainstorming on new ways to track things (which
--      pages get visited, what gets added and crossed off, on which device).
--   2. Debugging after the fact. Console output on the phone is gone the moment
--      the app reloads; these rows are not.
--
-- No retention purge on purpose: the user wants to keep everything and get an
-- email as storage fills up instead (added separately).

create table public.activity_events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- One per app load (tab/PWA launch). Groups everything that happened in it.
  session_id uuid not null,
  -- Client clock, so ordering inside a session is exact even when the batch is
  -- uploaded later (offline, or retried after a failed flush).
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  -- 'telegram' rows come from the bot and reminder edge functions.
  device text not null check (device in ('phone', 'desktop', 'telegram')),
  event_type text not null,
  -- No foreign key: history must stay readable after a page is deleted.
  page_id uuid,
  data jsonb not null default '{}'
);

alter table public.activity_events enable row level security;

create policy "Users can read their activity events"
  on public.activity_events for select using ((select auth.uid()) = user_id);
create policy "Users can insert their activity events"
  on public.activity_events for insert with check ((select auth.uid()) = user_id);

create index activity_events_user_time_idx
  on public.activity_events (user_id, occurred_at desc);
create index activity_events_session_idx
  on public.activity_events (session_id, occurred_at);
create index activity_events_type_time_idx
  on public.activity_events (event_type, occurred_at desc);

create table public.glitch_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_id uuid not null,
  flagged_at timestamptz not null,
  device text not null check (device in ('phone', 'desktop')),
  page_id uuid,
  -- Optional one-liner typed after the tap. Filled by a follow-up update, so
  -- the flag itself is saved even if the note box is dismissed.
  note text,
  -- Copy of the in-memory event trail from just before the tap. Redundant with
  -- activity_events when uploads work, and the only record when they don't.
  recent_events jsonb not null default '[]',
  context jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.glitch_flags enable row level security;

create policy "Users can read their glitch flags"
  on public.glitch_flags for select using ((select auth.uid()) = user_id);
create policy "Users can insert their glitch flags"
  on public.glitch_flags for insert with check ((select auth.uid()) = user_id);
create policy "Users can update their glitch flags"
  on public.glitch_flags for update using ((select auth.uid()) = user_id);

create index glitch_flags_user_time_idx
  on public.glitch_flags (user_id, flagged_at desc);

-- Keep the bot conversation log too. purge-bot-sessions
-- (20260817170454_purge_bot_sessions.sql) deleted sessions idle for 90 days,
-- cascading to bot_messages; the user wants that history kept. Guarded so the
-- migration also runs where the job was never scheduled.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-bot-sessions') then
    perform cron.unschedule('purge-bot-sessions');
  end if;
end
$$;
