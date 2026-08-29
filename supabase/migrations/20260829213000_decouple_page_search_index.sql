-- Take Library full-text indexing off the autosave write path.
--
-- `pages.search_tsv` was a GENERATED ALWAYS tsvector built with jsonb_to_tsvector
-- over the whole `content` JSON, backed by a 7.5 MB GIN index. Because it was
-- generated, *every* autosave -- one every 2 seconds while typing -- re-walked the
-- entire page JSON, rebuilt the word list, and updated the GIN index. `pages` has
-- taken 2.7 million updates.
--
-- The vector moves to its own table rather than becoming a plain column on
-- `pages`, because a cron job writing to `pages` would emit realtime UPDATE
-- events to usePageRealtime.js on every tick, and would sit uncomfortably close
-- to the `.eq('updated_at', knownTs)` optimistic-concurrency check in persistPage.
-- A separate table touches neither.
--
-- `library_sources.search_tsv` is deliberately left generated: that table has 4
-- rows and `source_text` only changes on Library ingest, so there is no autosave
-- churn to fix. Its DDL (like the core tables) predates this migrations folder --
-- see the baseline-capture follow-up.

-- ---------------------------------------------------------------------------
-- a. Record the pre-existing purge-library-activity job.
--
-- This job is already scheduled live but was created by hand and never written
-- down, so the repo pretended it did not exist. Re-scheduling is a no-op there;
-- this exists so the job is captured. cron.schedule() on an existing jobname
-- replaces the definition rather than duplicating it, but unschedule first so the
-- intent is explicit and the result is identical either way.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-library-activity') then
    perform cron.unschedule('purge-library-activity');
  end if;
end
$$;

select cron.schedule(
  'purge-library-activity',
  '35 4 * * *',
  $$ delete from public.library_activity where created_at < now() - interval '90 days' $$
);

-- ---------------------------------------------------------------------------
-- b. The new search table.
-- ---------------------------------------------------------------------------
create table if not exists public.page_search (
  page_id uuid primary key references public.pages(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  search_tsv tsvector,
  indexed_at timestamptz not null default now()
);

create index if not exists page_search_tsv_idx on public.page_search using gin (search_tsv);

alter table public.page_search enable row level security;

-- search_library() is SECURITY INVOKER, so RLS applies to callers. The refresh
-- job runs as `postgres` and bypasses it. Nothing but the job ever writes here,
-- so select is the only policy needed.
drop policy if exists "Users can read their page search rows" on public.page_search;
create policy "Users can read their page search rows"
  on public.page_search for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- c. Backfill, so search works the instant this lands.
-- ---------------------------------------------------------------------------
insert into public.page_search (page_id, user_id, search_tsv, indexed_at)
select
  p.id,
  p.user_id,
  to_tsvector('english', coalesce(p.title, '')) ||
    jsonb_to_tsvector('english', coalesce(p.content, '{}'::jsonb), '["string"]'),
  now()
from public.pages p
on conflict (page_id) do update
  set search_tsv = excluded.search_tsv,
      user_id    = excluded.user_id,
      indexed_at = excluded.indexed_at;

-- ---------------------------------------------------------------------------
-- d. Rewrite search_library() to read page_search.
--
-- Everything else about the function is unchanged: websearch_to_tsquery, ts_rank,
-- the ts_headline snippet config, the source_text union, the distinct on (id)
-- best-match pick, and the limit clamp. ts_headline still reads live content
-- through page_plain_text(p.title, p.content), so snippets stay current even when
-- the index is a few minutes stale.
-- ---------------------------------------------------------------------------
create or replace function public.search_library(
  p_user_id uuid,
  p_query text,
  p_limit integer default 20
)
returns table(
  page_id uuid,
  title text,
  snippet text,
  rank real,
  matched_in text,
  library_role text,
  section_id uuid
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  with q as (
    select websearch_to_tsquery('english'::regconfig, coalesce(p_query, '')) as tsq
  ),
  page_hits as (
    select
      p.id,
      p.title,
      p.library_role,
      p.section_id,
      ts_rank(ps.search_tsv, q.tsq) as rank,
      ts_headline(
        'english'::regconfig,
        public.page_plain_text(p.title, p.content),
        q.tsq,
        'MaxFragments=2,MaxWords=28,MinWords=8,StartSel=<b>,StopSel=</b>'
      ) as snippet,
      'page'::text as matched_in
    from public.pages p
    join public.page_search ps on ps.page_id = p.id, q
    where p.user_id = p_user_id
      and q.tsq is not null
      and ps.search_tsv @@ q.tsq
  ),
  source_hits as (
    select
      p.id,
      p.title,
      p.library_role,
      p.section_id,
      ts_rank(s.search_tsv, q.tsq) as rank,
      ts_headline(
        'english'::regconfig,
        coalesce(s.source_text, ''),
        q.tsq,
        'MaxFragments=2,MaxWords=28,MinWords=8,StartSel=<b>,StopSel=</b>'
      ) as snippet,
      'source_text'::text as matched_in
    from public.library_sources s
    join public.pages p on p.id = s.page_id, q
    where s.user_id = p_user_id
      and q.tsq is not null
      and s.search_tsv @@ q.tsq
  ),
  combined as (
    select * from page_hits
    union all
    select * from source_hits
  ),
  best as (
    select distinct on (id)
      id, title, snippet, rank, matched_in, library_role, section_id
    from combined
    order by id, rank desc
  )
  select id, title, snippet, rank, matched_in, library_role, section_id
  from best
  order by rank desc, title asc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$function$;

-- ---------------------------------------------------------------------------
-- e. Drop the generated column. This takes pages_search_idx with it and ends all
--    per-save tokenization and GIN maintenance. 112 rows, so the rewrite is
--    instant.
-- ---------------------------------------------------------------------------
alter table public.pages drop column if exists search_tsv;

-- ---------------------------------------------------------------------------
-- f. Refresh the index out of band.
--
-- On 2-59/5 rather than */5 so it never shares a minute with send-bot-reminders.
-- Only pages edited since their last index are touched, so a typical run updates
-- zero rows. A page edited now is findable in Library search within 5 minutes,
-- which is fine for a wiki that is not yet wired to a UI.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'refresh-page-search') then
    perform cron.unschedule('refresh-page-search');
  end if;
end
$$;

select cron.schedule(
  'refresh-page-search',
  '2-59/5 * * * *',
  $$ insert into public.page_search (page_id, user_id, search_tsv, indexed_at)
     select p.id, p.user_id,
            to_tsvector('english', coalesce(p.title, '')) ||
            jsonb_to_tsvector('english', coalesce(p.content, '{}'::jsonb), '["string"]'),
            now()
     from public.pages p
     left join public.page_search s on s.page_id = p.id
     where s.page_id is null or s.indexed_at < p.updated_at
     on conflict (page_id) do update
       set search_tsv = excluded.search_tsv,
           user_id    = excluded.user_id,
           indexed_at = excluded.indexed_at $$
);
