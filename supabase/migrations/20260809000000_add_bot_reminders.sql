-- Timed reminders derived from highlighted dates that carry a clock time.
--
-- THIS TABLE IS A SEND LEDGER, NOT A SCHEDULE. Nothing is ever "armed" here.
-- Every tick of send-reminders re-derives the complete reminder set from the
-- current documents and consults this table only to answer "did I already send
-- this one?". That is why editing a tracker line needs no invalidation: the old
-- dedup_key simply stops being derived, and the new one has no row yet.
--
-- (The alternative — a table of scheduled rows — would need invalidation on
-- every edit, and pages.updated_at churns every 2 seconds while the user types.)
--
-- Written via the service role (which bypasses RLS). The SELECT policy below is
-- defensive, scoped to the single owning user, matching the project's RLS style.

create table public.bot_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),

  -- Deterministic identity. Derived: 'd:<block_id>:<due_at_iso>:<lead_minutes>'
  --                        Snooze:  's:<block_id>:<fire_at_iso>'
  -- Deliberately EXCLUDES line text: fixing a typo must not re-fire.
  -- Deliberately INCLUDES due_at + lead: editing either yields a new key.
  dedup_key text not null,
  source text not null default 'derived' check (source in ('derived', 'snooze')),

  block_id text not null,
  page_id uuid references public.pages(id) on delete cascade,
  due_at timestamptz,                 -- null for snoozes
  lead_minutes integer,
  fire_at timestamptz not null,       -- effective send time, post-quiet-hours
  line_text text,                     -- snapshot, for debugging only

  status text not null default 'pending' check (status in ('pending', 'sent')),
  telegram_message_id bigint,         -- routes a "done"/"snooze" reply back here
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- The dedup gate. A claim-insert that hits 23505 means "already handled".
create unique index bot_reminders_dedup on public.bot_reminders (user_id, dedup_key);

-- Sweep lookup for pending snoozes.
create index bot_reminders_pending_idx on public.bot_reminders (status, fire_at);

-- Indexed FK (project convention — see 20260403000000_add_missing_fk_indexes.sql).
create index bot_reminders_page_id_idx on public.bot_reminders (page_id);

-- Quote-reply lookup: which reminder is the user replying "done" to?
create index bot_reminders_tg_msg_idx on public.bot_reminders (telegram_message_id)
  where telegram_message_id is not null;

alter table public.bot_reminders enable row level security;

create policy "Users can read their bot_reminders"
  on public.bot_reminders for select to authenticated
  using ((select auth.uid()) = user_id);
