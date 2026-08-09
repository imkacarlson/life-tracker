-- Telegram bot: conversation sessions + message turns.
-- The bot reads/writes these via the service role (which bypasses RLS). The
-- SELECT policies below are defensive, scoped to the single owning user, and
-- follow the project's current RLS style (TO authenticated, (select auth.uid())).

create table public.bot_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  telegram_chat_id bigint not null,
  status text not null default 'active' check (status in ('active', 'closed')),
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index bot_sessions_chat_active_idx
  on public.bot_sessions (telegram_chat_id, status, last_activity_at desc);

alter table public.bot_sessions enable row level security;

create policy "Users can read their bot_sessions"
  on public.bot_sessions for select to authenticated
  using ((select auth.uid()) = user_id);

create table public.bot_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.bot_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  telegram_message_id bigint,
  created_at timestamptz not null default now()
);

create index bot_messages_session_idx
  on public.bot_messages (session_id, created_at);

-- Dedup guard: the same inbound Telegram message can't be processed twice.
create unique index bot_messages_inbound_dedup
  on public.bot_messages (session_id, telegram_message_id)
  where telegram_message_id is not null and role = 'user';

alter table public.bot_messages enable row level security;

create policy "Users can read their bot_messages"
  on public.bot_messages for select to authenticated
  using (exists (
    select 1 from public.bot_sessions s
    where s.id = bot_messages.session_id
      and s.user_id = (select auth.uid())
  ));
