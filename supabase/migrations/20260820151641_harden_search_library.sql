-- Harden the search entry point. Caught by the Supabase security advisor
-- immediately after 20260820151324_add_full_text_search.sql.
--
-- THE BUG: search_library was SECURITY DEFINER *and* took p_user_id as a
-- parameter, and PostgREST exposes it at /rest/v1/rpc/search_library. The anon
-- key ships in the client bundle, so any caller who knew (or guessed) a user id
-- could have read that user's entire tracker and every stored source text,
-- because SECURITY DEFINER meant RLS never ran.
--
-- THE FIX: SECURITY INVOKER. This is strictly better and needs nothing else,
-- because the scoping already exists one layer down:
--   * an `authenticated` caller is filtered by the existing RLS policies on
--     `pages` and `library_sources`, so p_user_id can no longer widen anything —
--     passing someone else's id now returns zero rows instead of their data;
--   * `service_role` (the Telegram bot) bypasses RLS as it always has, and
--     p_user_id keeps doing the job it was actually there for: scoping.
--
-- p_user_id therefore stops being an authorization bypass and goes back to being
-- an ordinary filter.

create or replace function public.search_library(
  p_user_id uuid,
  p_query text,
  p_limit int default 20
)
returns table (
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
security invoker
set search_path = public, pg_temp
as $$
  with q as (
    select websearch_to_tsquery('english'::regconfig, coalesce(p_query, '')) as tsq
  ),
  page_hits as (
    select
      p.id,
      p.title,
      p.library_role,
      p.section_id,
      ts_rank(p.search_tsv, q.tsq) as rank,
      ts_headline(
        'english'::regconfig,
        public.page_plain_text(p.title, p.content),
        q.tsq,
        'MaxFragments=2,MaxWords=28,MinWords=8,StartSel=<b>,StopSel=</b>'
      ) as snippet,
      'page'::text as matched_in
    from public.pages p, q
    where p.user_id = p_user_id
      and q.tsq is not null
      and p.search_tsv @@ q.tsq
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
$$;

-- Belt and braces: anon has no business calling this even with RLS in the way.
revoke all on function public.search_library(uuid, text, int) from public;
revoke all on function public.search_library(uuid, text, int) from anon;
grant execute on function public.search_library(uuid, text, int) to authenticated, service_role;

-- Pin the helper's search_path too (advisor: function_search_path_mutable). It
-- is IMMUTABLE and touches only built-ins, so pg_catalog is all it needs.
create or replace function public.page_plain_text(p_title text, p_content jsonb)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(p_title, '') || ' — ' || coalesce(
    (
      select string_agg(value, ' ')
      from jsonb_array_elements_text(
        jsonb_path_query_array(coalesce(p_content, '{}'::jsonb), 'strict $.**.text')
      ) as t(value)
    ),
    ''
  );
$$;
