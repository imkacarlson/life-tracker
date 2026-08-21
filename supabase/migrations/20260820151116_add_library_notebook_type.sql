-- Library notebook: a third notebook kind, plus the page-role discriminant that
-- scopes everything the Library does.
--
-- Follows the recipes precedent (20260322000000_add_type_to_notebooks.sql): one
-- widened check constraint, no new table. A Library artifact — a capture, a topic
-- catalog, a section front page, Lately, Activity — is an ordinary `pages` row,
-- so the editor, autosave, realtime, navigation, deep links, and image handling
-- all come for free.
--
-- `pages` predates this migrations directory (there is no CREATE TABLE for it
-- anywhere; its constraint names still say `trackers_*`), so every change here
-- is an ALTER.

-- 1. Widen the notebook kinds. The constraint has to be dropped and re-added:
--    a check constraint can't be widened in place.
alter table public.notebooks
  drop constraint if exists notebooks_type_check;

alter table public.notebooks
  add constraint notebooks_type_check
  check (type in ('tracker', 'recipes', 'library'));

-- 2. The page-role discriminant. null for every page that exists today — this is
--    purely additive and no existing row changes meaning.
--
--    capture       an ingested source (article, podcast, note, thread). Hidden
--                  from the sidebar tree; reached from a topic page, a section
--                  front page, search, or a citation.
--    topic         a user-created catalog page over captures.
--    section_index a section's front page.
--    lately        the weekly disposable digest.
--    activity      the append-only log of what the model changed.
alter table public.pages
  add column if not exists library_role text;

alter table public.pages
  drop constraint if exists pages_library_role_check;

alter table public.pages
  add constraint pages_library_role_check
  check (
    library_role is null
    or library_role in ('capture', 'topic', 'section_index', 'lately', 'activity')
  );

-- Scoping lookups ("every capture in this section", "this section's front page").
-- Partial so the ~all-null existing corpus costs nothing.
create index if not exists pages_library_role_idx
  on public.pages (section_id, library_role)
  where library_role is not null;

-- One front page per section — mirrors pages_one_tracker_per_section_idx.
create unique index if not exists pages_one_section_index_per_section_idx
  on public.pages (section_id)
  where library_role = 'section_index';
