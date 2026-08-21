-- The immutable ingest record behind every Library capture page: one row per
-- capture, holding what was fetched and where it came from.
--
-- WHY source_text IS A COLUMN AND NOT PAGE CONTENT: a 10 KB article inside
-- pages.content would be rendered by Tiptap, shipped by the autosave queue on
-- every ~2s debounce (saveQueueController.js), broadcast over realtime, and held
-- in the page cache. It exists to be searched and read by the model, never by a
-- human, so it stays out of the document.
--
-- Written via the service role (which bypasses RLS). The SELECT policy is
-- defensive, scoped to the single owning user, matching the bot-table convention
-- in 20260530004356_add_bot_tables.sql. There are deliberately NO write policies.

create table public.library_sources (
  -- One source per capture page, and the page owns the lifetime.
  page_id uuid primary key references public.pages(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  source_type text not null check (source_type in ('article', 'podcast', 'note', 'thread')),
  url text,
  -- Dedup key: the url with tracking params stripped, or podcast:<feed>:<episode>.
  -- The partial unique index below IS the "do I already have this one?" check —
  -- a plain DB lookup, never a model call.
  canonical_url text,
  -- Extracted markdown. Searched and read by the model; never rendered in the editor.
  source_text text,
  -- author, published, site, episode number, feed url, …
  source_meta jsonb not null default '{}'::jsonb,
  -- Fail loudly: anything but 'ok' means the bot tells the user it couldn't read
  -- the source. Silently storing a paywall teaser as if it were the article is
  -- the failure mode this column exists to prevent.
  extract_status text not null check (extract_status in ('ok', 'thin', 'blocked', 'error', 'none')),
  extract_error text,
  -- The "saved ✅" reply's message_id, so a later quote-reply carrying a wall of
  -- pasted text can attach itself to this capture — the same mechanism
  -- bot_preview_jobs.preview_message_id already uses for proposals.
  telegram_message_id bigint,
  fetched_at timestamptz,
  created_at timestamptz not null default now()
);

-- "Already have this one?" — and the reason multi-note works: a hit turns the
-- proposal into "append a dated note to the existing capture".
create unique index library_sources_canonical_url_idx
  on public.library_sources (user_id, canonical_url)
  where canonical_url is not null;

-- Quote-reply lookup: find the capture whose confirmation the user replied to.
create index library_sources_telegram_message_idx
  on public.library_sources (telegram_message_id)
  where telegram_message_id is not null;

alter table public.library_sources enable row level security;

create policy "Users can read their library_sources"
  on public.library_sources for select to authenticated
  using ((select auth.uid()) = user_id);
