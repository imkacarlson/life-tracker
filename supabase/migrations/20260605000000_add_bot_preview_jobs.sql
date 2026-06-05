-- Telegram bot: pending "add to tracker" proposals awaiting the user's confirmation.
--
-- The bot proposes an edit, renders a preview screenshot, and stores the proposed
-- document here (NOT in `pages` — the AI never writes the tracker). The write
-- happens only as a pure code path once the user's reply is classified as a
-- confirmation (see capture.ts). Rows are deleted on confirm/cancel/replace; the
-- expires_at column + a daily sweep purge anything left dangling.
--
-- Written via the service role (which bypasses RLS). The SELECT policy below is
-- defensive, scoped to the single owning user, matching the project's RLS style.

create table public.bot_preview_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  session_id uuid references public.bot_sessions(id) on delete set null,
  page_id uuid not null references public.pages(id) on delete cascade,
  -- OCC snapshot: the page's updated_at when the proposal was built. On apply we
  -- only write if the page is unchanged; otherwise we re-apply from `placement`.
  base_updated_at timestamptz not null,
  -- The full proposed Tiptap doc JSON (target page content with the insertion applied).
  proposed_content jsonb not null,
  -- Top-level block ids of the inserted content — highlighted in the preview.
  inserted_block_ids text[] not null default '{}',
  -- Re-apply recipe if the page drifted: { targetBlockId, position, format, items }.
  placement jsonb not null,
  -- Telegram message_id of the sent preview photo, so a quote-reply can re-activate
  -- this exact proposal even past the idle window.
  preview_message_id bigint,
  status text not null default 'pending' check (status in ('pending', 'applied', 'cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '48 hours')
);

-- Quote-reply lookup: find the job whose preview the user replied to.
create index bot_preview_jobs_preview_message_idx
  on public.bot_preview_jobs (preview_message_id)
  where preview_message_id is not null;

-- Newest-pending-in-scope lookup for a bare confirmation.
create index bot_preview_jobs_user_status_created_idx
  on public.bot_preview_jobs (user_id, status, created_at desc);

alter table public.bot_preview_jobs enable row level security;

create policy "Users can read their bot_preview_jobs"
  on public.bot_preview_jobs for select to authenticated
  using ((select auth.uid()) = user_id);

-- Daily sweep of expired proposals. pg_cron is already enabled (see
-- 20260329000001_add_pg_cron_scores.sql). The bot also purges opportunistically
-- on every inbound message, so the table stays small even between sweeps.
select cron.schedule(
  'purge-bot-preview-jobs',
  '17 4 * * *',
  $$ delete from public.bot_preview_jobs where expires_at < now() $$
);
