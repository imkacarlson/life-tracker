-- Page history: a copy of every page whose title or content changed since its
-- last snapshot, taken once a day, plus a copy of any page right before it is
-- deleted.
--
-- Why: pages only ever hold their current version. The activity log records
-- edits made in the editor, but not edits applied straight to the row (the
-- Telegram bot, AI Daily) or made while recording is off, and it can't answer
-- "what did this page look like on Aug 12" without replaying months of events.
-- Daily copies answer that directly and double as an undo for accidents.
--
-- Cost: only changed pages are copied, and jsonb is compressed on disk, so a
-- few MB a month. No retention purge on purpose (the user keeps everything and
-- gets emailed as storage fills, see storage-alerts).

create table public.page_snapshots (
  id bigint generated always as identity primary key,
  -- No foreign key: a deleted page's snapshots are the whole point.
  page_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  section_id uuid,
  title text,
  content jsonb,
  -- md5 of content::text, so "did it change" is one comparison.
  content_hash text not null,
  reason text not null check (reason in ('baseline', 'daily', 'deleted')),
  page_updated_at timestamptz,
  captured_at timestamptz not null default now()
);

-- Read-only from the browser; only the functions below write.
alter table public.page_snapshots enable row level security;

create policy "Users can read their page snapshots"
  on public.page_snapshots for select using ((select auth.uid()) = user_id);

create index page_snapshots_page_time_idx
  on public.page_snapshots (page_id, captured_at desc);
create index page_snapshots_user_time_idx
  on public.page_snapshots (user_id, captured_at desc);

-- Copy every page that differs from its latest snapshot. A page with no
-- snapshot yet gets a 'baseline' row. Returns how many pages were copied.
create or replace function public.snapshot_changed_pages()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  copied integer;
begin
  insert into public.page_snapshots
    (page_id, user_id, section_id, title, content, content_hash, reason, page_updated_at)
  select
    p.id,
    p.user_id,
    p.section_id,
    p.title,
    p.content,
    md5(coalesce(p.content::text, '')),
    case when last.content_hash is null then 'baseline' else 'daily' end,
    p.updated_at
  from public.pages p
  left join lateral (
    select s.content_hash, s.title
    from public.page_snapshots s
    where s.page_id = p.id
    order by s.captured_at desc
    limit 1
  ) last on true
  where last.content_hash is distinct from md5(coalesce(p.content::text, ''))
     or last.title is distinct from p.title;

  get diagnostics copied = row_count;
  return copied;
end;
$$;

revoke all on function public.snapshot_changed_pages() from public, anon, authenticated;

-- Keep a copy of a page as it was the moment it is deleted (including pages
-- removed by a section/notebook delete cascading down).
create or replace function public.snapshot_deleted_page()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.page_snapshots
    (page_id, user_id, section_id, title, content, content_hash, reason, page_updated_at)
  values
    (old.id, old.user_id, old.section_id, old.title, old.content,
     md5(coalesce(old.content::text, '')), 'deleted', old.updated_at);
  return old;
end;
$$;

revoke all on function public.snapshot_deleted_page() from public, anon, authenticated;

create trigger pages_snapshot_before_delete
  before delete on public.pages
  for each row execute function public.snapshot_deleted_page();

-- First copy of everything, so history starts today.
select public.snapshot_changed_pages();

-- 4:47 AM UTC (11:47 PM Eastern): end of the user's day. Unused minute — 17,
-- 23, 35 and 41 belong to the other 4 AM jobs.
select cron.schedule(
  'snapshot-changed-pages',
  '47 4 * * *',
  $$ select public.snapshot_changed_pages() $$
);
