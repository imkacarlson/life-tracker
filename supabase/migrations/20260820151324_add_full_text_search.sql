-- Full-text search across pages and stored source text.
--
-- The project has no FTS today — zero GIN indexes exist. This adds one generated
-- tsvector column per searchable surface plus a GIN index, and one
-- `security definer` function so no caller ever has to assemble the union.
--
-- THE REGCONFIG CASTS ARE LOAD-BEARING. `to_tsvector(regconfig, text)` and
-- `jsonb_to_tsvector(regconfig, jsonb, jsonb)` are IMMUTABLE and therefore legal
-- in a generated column. The shorthand forms WITHOUT an explicit regconfig are
-- only STABLE (they depend on default_text_search_config) and Postgres rejects
-- them here. Verified against this database's pg_proc.provolatile.
--
-- ON CHURN: `pages` is updated roughly every 2s while the user types (the
-- autosave debounce). The corpus is 108 pages / 935 kB total / 8.9 kB average /
-- 108 kB largest — recomputing a tsvector over even the largest document is
-- single-digit milliseconds, and GIN fastupdate buffers single-row changes. At
-- this scale a conditional column and partial index are not worth the
-- complexity, so the index is unconditional.
--
-- DELIBERATE BONUS: this makes the TRACKER searchable too, which is a separate
-- thing the user wanted ("what was on my plate for the wedding"). It falls out
-- for free.

alter table public.pages
  add column if not exists search_tsv tsvector
  generated always as (
    to_tsvector('english'::regconfig, coalesce(title, ''))
    || jsonb_to_tsvector('english'::regconfig, coalesce(content, '{}'::jsonb), '["string"]')
  ) stored;

create index if not exists pages_search_idx on public.pages using gin (search_tsv);

-- The extracted article / episode text. Never rendered in the editor; it exists
-- to be searched and read by the model, which is this index's whole purpose.
alter table public.library_sources
  add column if not exists search_tsv tsvector
  generated always as (to_tsvector('english'::regconfig, coalesce(source_text, ''))) stored;

create index if not exists library_sources_search_idx
  on public.library_sources using gin (search_tsv);

-- Flatten a page to readable text for ts_headline. The GIN index uses
-- jsonb_to_tsvector directly and never needs this; a snippet does, because
-- ts_headline highlights inside a plain string.
--
-- `strict $.**.text` is deliberate: lax mode (the default) returns every value
-- TWICE, once for the container and once for the element, which would double
-- every word in the snippet. Strict mode returns each text run once and, as
-- verified against this database, still returns an empty array rather than
-- erroring on '{}', on a doc with no text, and on JSON null.
create or replace function public.page_plain_text(p_title text, p_content jsonb)
returns text
language sql
immutable
parallel safe
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

-- One entry point for search.
--
-- `matched_in` is what lets the bot say "found it in the transcript" instead of
-- silently citing a page whose visible summary doesn't contain the search term.
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
security definer
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
  -- Best rank per page: a capture whose title AND transcript both match should
  -- appear once, ranked on its strongest evidence.
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

revoke all on function public.search_library(uuid, text, int) from public;
grant execute on function public.search_library(uuid, text, int) to authenticated, service_role;

comment on function public.search_library(uuid, text, int) is
  'Full-text search over a user''s pages and stored Library source text. '
  'matched_in tells the caller whether the hit was in the page itself or in the '
  'extracted source, so an answer can say where it found the thing.';
