-- What the model NOTICED, offered as a card the user can act on — and the only
-- place in the Library where model-written prose reaches the user.
--
-- WHY A TABLE AND NOT A PAGE. libraryCatalog.ts opens with "there is deliberately
-- no place in this module where a model writes a sentence of its own", and a
-- suggestion's `why` IS a model-written sentence. Rendering it into a page would
-- break that guarantee; storing it beside the page does not. The panel that
-- renders these rows is a React control, not document content, so a suggestion
-- never lands in stored page JSON, never appears in an export, and leaves no
-- residue when it is dismissed.
--
-- WHY ROWS AND NOT A LIVE MODEL CALL. Same store-then-render split as
-- library_topic_members: the noticing pass runs on its own schedule (the
-- library-suggest function), writes rows, and the app reads rows. That is what
-- keeps the ZERO MODEL CALLS invariant on runLibraryRebuild intact — a rebuild
-- runs after EVERY capture, and it stays free.
--
-- NOT A QUEUE (rule 5). The live set is replaced wholesale on every run and is
-- capped at five. It never accumulates and there is no count to clear.
--
-- Written by the service role in normal use — the app never authors a
-- suggestion, it only stamps dismissed_at / accepted_at on one.

create table public.library_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  -- What the suggestion would create, which is also WHERE it is shown:
  --   'section'  a new Library section. Offered on Lately, over the whole Library.
  --   'topic'    a new topic inside one section. Offered on that section's Overview.
  -- The suggestion level matches the page level; nothing suggests across levels.
  scope text not null check (scope in ('section', 'topic')),
  -- null for section scope (it is Library-wide), required for topic scope.
  section_id uuid references public.sections(id) on delete cascade,
  -- What the user would be making. Their words back at them where possible.
  title text not null,
  -- One model-written sentence on what it noticed. The prose that cannot live
  -- on a page. Observational by prompt ("2 saved, both about recovering from a
  -- rough race"), never a claim about the world.
  why text not null default '',
  -- The captures it was reading. Kept so a strange suggestion is traceable, the
  -- same reason library_topic_members.reason exists.
  evidence_page_ids uuid[] not null default '{}',
  generated_at timestamptz not null default now(),
  -- "Not interested". Fed back into the next prompt as already-rejected, so the
  -- same card cannot return every week and become a chore.
  dismissed_at timestamptz,
  -- "Make it a topic" was clicked and the thing now exists. Kept apart from
  -- dismissed_at on purpose: only a real rejection may teach the prompt to stop
  -- proposing something.
  accepted_at timestamptz,

  -- Section scope is Library-wide and has no section; topic scope must name one.
  constraint library_suggestions_scope_section_check check (
    (scope = 'section' and section_id is null)
    or (scope = 'topic' and section_id is not null)
  )
);

-- The panel's read: the live set for one page.
create index library_suggestions_live_idx
  on public.library_suggestions (user_id, scope, section_id)
  where dismissed_at is null and accepted_at is null;

alter table public.library_suggestions enable row level security;

create policy "Users can read their library_suggestions"
  on public.library_suggestions for select to authenticated
  using ((select auth.uid()) = user_id);

-- The app's only write in normal use: dismissing and accepting both stamp a
-- timestamp on a row the service role created.
create policy "Users can resolve their library_suggestions"
  on public.library_suggestions for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Owner insert, which library_sources and bot_preview_jobs deliberately do NOT
-- have. The difference is what the row holds: those carry fetched third-party
-- content and a staged write, so keeping them service-role-only is a real
-- boundary. A suggestion is inert data ABOUT the user's own library that renders
-- a card with a button on it — a user writing one to themselves is meaningless.
-- What it buys is an E2E suite that can seed cards and prove the panel renders,
-- dismisses, and creates, with no model call anywhere in the test.
create policy "Users can insert their library_suggestions"
  on public.library_suggestions for insert to authenticated
  with check ((select auth.uid()) = user_id);
