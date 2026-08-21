-- Topic membership: which captures a topic page catalogs.
--
-- WHY THIS DEPARTS FROM THE HOUSE LEDGER PATTERN, DELIBERATELY.
-- bot_reminders opens with "THIS TABLE IS A SEND LEDGER, NOT A SCHEDULE" and
-- re-derives its whole set every tick. That is the right call there, because
-- derivation is pure regex over document JSON — free and deterministic.
--
-- Here, derivation is an LLM judgement. Re-deriving weekly would cost tokens
-- proportional to the whole Library forever, and would let a capture flicker in
-- and out of a topic between runs. Stored membership makes the catalog stable
-- and gives backlinks ("which topics cite this capture?") as a one-line query.
-- The invalidation risk the ledger pattern avoids barely applies: nothing about
-- a capture changes after ingest except the user's own note.
--
-- Membership is decided at exactly two moments, never on a schedule:
--   1. At capture time — the ingest call already has the summary in hand and
--      asks which of that section's EXISTING topics the capture belongs to.
--   2. When a topic is created — a one-off backfill over that section's captures.
-- The weekly rebuild only RENDERS from stored membership. It never re-decides.

create table public.library_topic_members (
  topic_page_id uuid not null references public.pages(id) on delete cascade,
  capture_page_id uuid not null references public.pages(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  -- 'ingest' | 'backfill' | 'user' — where this membership came from, so a
  -- surprising catalog entry can be traced.
  added_by text not null default 'ingest' check (added_by in ('ingest', 'backfill', 'user')),
  -- One short phrase saying why it belongs. Rendered nowhere by default; it
  -- exists so a wrong grouping is debuggable rather than mysterious.
  reason text,
  added_at timestamptz not null default now(),
  primary key (topic_page_id, capture_page_id)
);

-- Backlinks: "which topics cite this capture?"
create index library_topic_members_capture_idx
  on public.library_topic_members (capture_page_id);

alter table public.library_topic_members enable row level security;

create policy "Users can read their library_topic_members"
  on public.library_topic_members for select to authenticated
  using ((select auth.uid()) = user_id);

-- Rebuild scoping. Only topics whose section received a capture since this
-- timestamp get touched; everything else is skipped and the skip is logged.
-- An unscoped "update the wiki" is a documented failure mode of this pattern,
-- and these two columns are what make the scoping visible in Activity.
alter table public.pages
  add column if not exists library_rebuilt_at timestamptz;

-- The append-only record of what the model changed, and the ability to undo it.
--
-- prev_content is the page's document immediately BEFORE the rebuild wrote it —
-- that IS the revert payload, and revert is a plain restore. Safe precisely
-- because only model-owned pages (topic, section_index, lately, activity) are
-- ever rewritten. The user's own writing lives on capture pages, which the
-- rebuild never touches.
create table public.library_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  kind text not null check (
    kind in ('topic_rebuilt', 'section_rebuilt', 'lately_rebuilt', 'topic_created',
             'page_created', 'capture_filed', 'skipped', 'reverted')
  ),
  target_page_id uuid references public.pages(id) on delete set null,
  summary text not null,
  prev_content jsonb,
  created_at timestamptz not null default now()
);

create index library_activity_user_created_idx
  on public.library_activity (user_id, created_at desc);

alter table public.library_activity enable row level security;

create policy "Users can read their library_activity"
  on public.library_activity for select to authenticated
  using ((select auth.uid()) = user_id);
