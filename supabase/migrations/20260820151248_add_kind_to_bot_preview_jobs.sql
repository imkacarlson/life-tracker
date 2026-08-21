-- Let the existing preview-job table carry a Library capture proposal as well as
-- a tracker addition.
--
-- WHY REUSE THIS TABLE: findPendingJob (telegram-bot/capture.ts) is a single
-- lookup, and quote-reply re-activation keys off preview_message_id. A second
-- table would make every inbound message check two places and would fork the
-- one code path that guarantees the AI never writes to `pages`.
--
-- The table's design is OCC against an EXISTING page, and that splits cleanly by
-- mode:
--   append  a second thought on a capture that already exists. This is exactly
--           an OCC update — every existing column means what it already means
--           and nothing is relaxed.
--   new     a capture that doesn't exist yet. There is no target, so page_id and
--           base_updated_at have to become nullable, and `placement` carries the
--           filing recipe instead: { sectionId, title, sourceId, mode }.
--
-- The check constraint below keeps that honest: only a library capture is
-- allowed to have no target page.

alter table public.bot_preview_jobs
  add column if not exists kind text not null default 'tracker_addition';

alter table public.bot_preview_jobs
  drop constraint if exists bot_preview_jobs_kind_check;

alter table public.bot_preview_jobs
  add constraint bot_preview_jobs_kind_check
  check (kind in ('tracker_addition', 'library_capture'));

-- Relax the two OCC columns. Every existing row keeps its values; only a
-- brand-new library capture leaves them null.
alter table public.bot_preview_jobs alter column page_id drop not null;
alter table public.bot_preview_jobs alter column base_updated_at drop not null;

-- ...and immediately re-tighten for everything else, so a tracker addition can
-- never silently lose its OCC snapshot.
alter table public.bot_preview_jobs
  drop constraint if exists bot_preview_jobs_target_required;

alter table public.bot_preview_jobs
  add constraint bot_preview_jobs_target_required
  check (
    kind = 'library_capture'
    or (page_id is not null and base_updated_at is not null)
  );
