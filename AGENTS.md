# AGENTS.md

## Project Overview

Building a personal task/notes tracker web app to replace OneNote. Single-user app accessed via browser on laptop and Android phone.

## Tech Stack

- **Frontend:** React with Vite
- **Backend/Database:** Supabase (Postgres + Auth + Realtime)
- **Rich Text Editor:** Tiptap (ProseMirror-based)
- **Hosting:** Vercel (later)
- **AI:** Claude API (Phase 5)

## Core Workflow to Replicate

The user organizes tasks in monthly "trackers" that are rich text documents:
- Each month has a tracker page (e.g., "January 2026 Tracker")
- Tracker contains **categories** as sections (Running, Finance, Wedding, etc.)
- Each category contains rich content: bullet lists, numbered lists, nested lists, tables, images, links, etc.
- The editor should feel like OneNote/Google Docs - a full rich text editing experience
- Daily, user creates a **daily task list** by linking to items within tracker documents
- Completing an item crosses it off in both places

## Development Phases

### Phase 1: Foundation ✅ COMPLETE
- React + Vite scaffolded
- Supabase Auth working (email/password, single user)
- Test table verified read/write
- Sign up removed from UI

### Phase 2: Rich Text Editor & Document Storage (CURRENT PHASE)

**Goal:** Replace the test items UI with a full rich text editor that saves tracker documents to Supabase.

1. Install Tiptap and extensions:
   - `@tiptap/react` `@tiptap/starter-kit` `@tiptap/pm`
   - Extensions: `@tiptap/extension-table` `@tiptap/extension-table-row` `@tiptap/extension-table-cell` `@tiptap/extension-table-header`
   - Extensions: `@tiptap/extension-image` `@tiptap/extension-link` `@tiptap/extension-highlight` `@tiptap/extension-underline` `@tiptap/extension-text-align` `@tiptap/extension-color` `@tiptap/extension-text-style` `@tiptap/extension-placeholder`
   - Extensions for lists: `@tiptap/extension-bullet-list` `@tiptap/extension-ordered-list` `@tiptap/extension-list-item` `@tiptap/extension-task-list` `@tiptap/extension-task-item`

2. Create the database schema in Supabase:
   ```sql
   -- Drop the test table
   drop table if exists public.test_items;

   -- Tracker documents
   create table public.trackers (
     id uuid primary key default gen_random_uuid(),
     user_id uuid not null references auth.users(id),
     title text not null,
     content jsonb default '{}',
     created_at timestamptz default now(),
     updated_at timestamptz default now()
   );

   alter table public.trackers enable row level security;

   create policy "Users can read their trackers"
     on public.trackers for select using (auth.uid() = user_id);
   create policy "Users can insert their trackers"
     on public.trackers for insert with check (auth.uid() = user_id);
   create policy "Users can update their trackers"
     on public.trackers for update using (auth.uid() = user_id);
   create policy "Users can delete their trackers"
     on public.trackers for delete using (auth.uid() = user_id);
   ```

3. Build the UI:
   - **Sidebar/nav:** List of tracker documents with "New Tracker" button
   - **Main area:** Tiptap editor with toolbar
   - **Toolbar features:** Bold, italic, underline, strikethrough, highlight, text color, headings, bullet list, numbered list, task list (checkboxes), table (insert, add/remove rows/cols, cell color), image (paste or upload), link, undo/redo
   - Keep toolbar clean and standard - use an icon-based toolbar similar to Google Docs/Notion

4. Auto-save: Save document content (Tiptap JSON) to Supabase on changes with debounce (e.g., 2 seconds after last edit)

5. Image handling: Upload pasted/dropped images to Supabase Storage, store the URL in the document

**Phase 2 complete when:** User can create tracker documents, edit them with rich text features (lists, tables, images, links), and content persists across page reloads.

### Phase 3: Daily Task List & Linking
- Daily view page
- Link to specific items/sections within tracker documents
- Cross-off syncs between daily list and tracker
- Tiptap supports node IDs for anchoring links

### Phase 4: Mobile Polish & Touch (IN PROGRESS)
- Responsive CSS for phone browser ✅
- Touch-friendly toolbar ✅ (keyboard-aware: lifts above virtual keyboard via `useVirtualKeyboard` hook)
- Drawing/annotation support (Tiptap has extensions for this)

### Phase 5: AI Integration
- Claude API connection
- AI reads Tiptap JSON to understand tracker content
- "Generate today's tasks" feature
- Chat interface for querying tracker

## Code Style Preferences

- Keep code simple and readable - user is not experienced in JavaScript/React
- Prefer clear patterns over clever abstractions
- Comment non-obvious logic
- Break components into separate files when they get large (e.g., Toolbar, Sidebar, Editor should be separate components)
- This is a personal project - working beats perfect

## Modularization & Growth Control

- Build and maintain code like a well-organized senior engineer: clear ownership, clear boundaries, minimal coupling.
- Keep each file focused on one primary responsibility. If a file starts mixing rendering, async data, persistence, and feature orchestration, split it before adding more logic.
- When editing an existing large file, do not increase responsibility sprawl. Prefer extracting helpers/hooks/subcomponents first, then add the new behavior.
- Preserve external contracts during refactors (component props, hook return shapes, utility signatures) so behavior does not break while internals are reorganized.
- Favor incremental extraction in the same change instead of deferring cleanup.
- Keep styles organized by concern (base/layout/editor/toolbar/modal/responsive) rather than adding everything to one stylesheet.
- For hotspot-file changes, include a short checklist in your summary:
  - What concern was added/changed
  - What was extracted (or why extraction was not needed)
  - What regression checks were run

## Testing

Two-layer test strategy: **Vitest** for pure logic, **Playwright** for user journeys. Both run on every PR as a single gate (unit tests first, then E2E).

### Unit tests (Vitest)

Unit tests live in `src/utils/__tests__/`. They cover pure functions that take plain JS objects and return plain JS objects — no DOM, no jsdom needed.

- `contentHelpers.test.js` — normalizeContent, collectStoragePaths, sanitizeContentForSave
- `imageCleanup.test.js` — findRemovedImagePaths, collectAllImagePaths
- `navigationHelpers.test.js` — buildHash, parseDeepLink
- `listHelpers.test.js` — getListDepthAt, getListItemTypeAt (uses real ProseMirror Schema/EditorState)
- `draftHelpers.test.js` — detectConflict

**When to write a unit test:** If the function takes plain JS objects (or ProseMirror state) and returns data without requiring a browser or Tiptap editor view — unit test it.

**When to write an E2E test:** If the behavior requires a browser, editor interaction, or real Supabase — E2E test it.

### E2E tests (Playwright)

Playwright E2E tests live in `e2e/`. Two viewport projects run automatically:
- **Desktop Chrome** — default desktop viewport
- **Mobile Chrome** — Pixel 7 device profile, overridden to 1080×2400 with touch enabled

**Test user:** A separate Supabase account (not real user data). Create via Supabase dashboard, then:
1. Copy `.env.test` and fill in `TEST_USER_EMAIL`, `TEST_USER_PASSWORD`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
2. Add matching GitHub Secrets for CI (`TEST_USER_EMAIL`, `TEST_USER_PASSWORD`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)

**Test philosophy:** Behavioral assertions; use `getByRole`/`getByText` where possible. Tests should survive UI overhauls.

**Seed data:** Tests are self-contained — each test creates its own data (pages, sections, etc.) in `beforeAll` via the Supabase API using helpers from `e2e/test-helpers.js`. The `isolateSupabaseData` fixture in `e2e/fixtures.js` snapshots and restores DB state between tests as a safety net.

### ProseMirror boundary

Functions inside React hooks that use ProseMirror `EditorState` should be extracted into standalone util files (e.g., `src/utils/listHelpers.js`) and unit-tested with real ProseMirror state objects constructed via `@tiptap/pm/model` + `@tiptap/pm/state`. No jsdom needed — ProseMirror's state layer is pure JS.

### Edge function shared code (`supabase/functions/_shared/`)

Logic used by more than one edge function lives in `supabase/functions/_shared/`. The leading underscore is the Supabase CLI convention for non-deployed shared code — the CLI bundles it into every importing function. Prefer this over a peer-function reach-in (`../generate-daily/foo.ts`).

**House rule for every module in `_shared/`:** zero `jsr:` / `npm:` / `https://` imports and zero top-level `Deno.*`. That is what lets Vitest import them directly. Anything needing an env var takes it as a parameter (see `deepLink.ts`, which takes `appUrl`). Their `*.test.ts` files sit alongside them and are picked up by `vitest.config.js`'s glob.

## Library notebook

A third notebook kind (`type = 'library'`) for things the user wants to **find again later**, as
opposed to the trackers, which hold things with a lifespan. The organizing principle is **recall,
not synthesis**: pages catalog what was saved, in the user's own words, with dates. They never
assert a conclusion.

### The seven rules the code enforces

1. **Sections are the user's.** The model files *into* them and may propose a new one at confirm
   time. It never creates one.
2. **Topics exist only because the user made one.** The model may *suggest*; it never creates. The
   user makes one from a suggestion card, from the block's "make your own" slot, from the sidebar's
   `+ New topic`, or by telling the bot — four doors, one insert.
3. **Catalog, never assert.** No claims, no consensus statements, no advice. See the header comment
   in `_shared/libraryCatalog.ts`.
4. **The user never authors in the Library.** The only human-written text is the note on a capture
   and the NAME of a topic or section they chose to make — never a page's body. No rebuild ever
   touches a capture page.
5. **Nothing is ever a queue.** No counts-as-badges, no "unprocessed". Lately is rewritten weekly
   and never accumulates.
6. **Everything reversibly.** `library_activity.prev_content` is the revert payload;
   `revert_library_page` is the undo.
7. **Four page roles never appear as sidebar rows under their section:** `capture`,
   `section_index`, `lately`, `activity` (`HIDDEN_TREE_ROLES`). Captures are reached from a topic
   page, a section front page, search, or a citation. A section's `Overview` IS its section row.
   `Lately` and `Activity` are hoisted to notebook level. Hidden never means unopenable — the
   filter lives in `getVisibleSectionPages`, never in `getSectionPages`.

### What makes it navigable

Captures are hidden from the sidebar by rule 7, so a Library with only captures in it looks empty.
The pages that fix that are all model-owned and all rendered from stored data.

**What the DATABASE holds:**

```
Running         (section)     ← the user's
  └ Overview                  (section_index — the front page: topics + what landed recently)
  └ Fueling                   (topic, once the user asks for one)
  └ …                         (captures)
Home            (section)     ← created by the rebuild, the one section that isn't the user's
  └ Lately                    ← the last 30 days, Library-wide. Rewritten every run, never accumulates.
  └ Activity                  ← what the rebuild did, including its skips
```

**What the SIDEBAR shows** (`src/utils/libraryTree.js`):

```
Library
  Lately                      ← hoisted out of Home, always first
  Running        31           ← clicking the SECTION opens its Overview. Muted capture count.
    Fueling   CATALOG         ← the only child row: model-owned pages are tagged
  Activity                    ← hoisted out of Home, always last
```

The two differ on purpose, and rule 7 covers all four hidden roles — `capture`, `section_index`,
`lately`, `activity` (`HIDDEN_TREE_ROLES` in `src/utils/sectionPages.js`):

- **`Overview` has no row.** The section row *is* the front page — `pickSectionLandingPage` chooses
  it by ROLE, never by sort order, because `createPage` reindexes a whole section to `index + 1` and
  the sentinel order does not survive. Two adjacent rows for one thing is what made a first pass
  unreadable.
- **`Lately` and `Activity` are hoisted to notebook level**, because they are Library-WIDE. Nesting
  them under a section nobody made put the two most useful pages where nobody would look.
- **The `Home` section row is suppressed** — but only while it holds nothing else. A stray page in
  there brings the row back, rather than orphaning a page with no way in.
- **The capture count on a section row is a deliberate exception to rule 5.** With captures hidden,
  it is the only sign a section holds anything. Muted mono, no background, not actionable.

The `Home` **section** is the single deliberate exception to rule 1. It holds the model's own
scaffolding, never a topical category, and it is logged in Activity. Every other section gets a
front page titled `Overview`; `Home` does not, since an index of two pages would be noise.

**`Home` and `Overview` must stay different words**, even though neither is a row today. A first
pass named both "Overview" and the sidebar became unreadable on sight — two adjacent rows sharing
one label, one a page and one a section, with nothing saying which was which. They still collide in
breadcrumbs, search results, and any future flat listing.

**The home section is found by what it holds, not by its name** — on BOTH sides
(`ensureHomeSection` in the rebuild, `getLibraryTreeShape` in the sidebar). Wherever Lately and
Activity live IS the home section, whatever the user renamed it to. Matching on the title would mean
a rename silently spawned a second one on the next capture, with no way for the user to tell why —
and if only one side matched on contents, a rename would make the sidebar suppress one section while
the rebuild wrote to another. Renaming therefore sticks; deleting does not, since the next capture
needs somewhere to put those two pages.

**Page metadata is lazy, so an expanded Library prefetches every section** (`NavigationTree`).
That is required, not an optimization: Lately and Activity are hoisted out of the section they live
in, so nothing would ever expand it, and without the prefetch they would simply never appear.

**The rebuild runs after every capture, not just weekly.** It makes **zero model calls** — the
summary was written once by the no-tools call at capture time and stored on the page, and topic
membership was decided in that same call and stored as rows. So a rebuild costs one function
invocation and no tokens, which is what lets a save show up in the app immediately instead of up to
a week later. The hook is in `telegram-bot/index.ts`'s confirm branch, scoped to the capture's
section, after the reply is sent, wrapped in a try/catch that only logs: the capture is already
committed by then, and a rendering failure must never turn a successful save into an error message.
The `library-rebuild` cron is the safety net, not the trigger.

### Worth a topic? — the one place model prose reaches the user

Topics exist only because the user made one (rule 2), which left a Library with no way to make one
from the app at all once `+ New page` was disabled. Two front doors fix that, and they are **one
UI**: a fixed block of five slots above `Lately` and above each section's `Overview`. Filled slots
are what the noticing pass noticed; the leftover slot is a dashed "make your own" card. The block
never empties and never accumulates — it is a view, not a queue.

**The suggestion level matches the page level**, because that is the only level at which a
suggestion has a meaning:

| Page | Suggests | Evidence it reads |
|---|---|---|
| `Lately` | new **sections** | the whole Library |
| a section's `Overview` | new **topics** in that section | that section's captures |

**It is a React panel, not a Tiptap node.** `libraryCatalog.ts:17` guarantees there is no place in
that module where a model writes a sentence of its own — and a suggestion's `why` **is** a
model-written sentence. Beside the page it can be that; inside the page it could not. Suggestion
cards are also controls rather than content: they must not survive into stored page JSON, into an
export, or as residue once dismissed. (The old pure-counting `suggestTopics()` and its
"Maybe a topic?" text block were **removed**, not left beside this — two competing suggestion UIs
is exactly the layering the house rules warn against.)

**The noticing pass is a model call, and it lives OUTSIDE `runLibraryRebuild`.** The ZERO MODEL
CALLS invariant at `libraryRebuild.ts:9-14` is what makes a post-capture rebuild free, and it stays
intact. `library-suggest` writes rows; the panel renders rows — the same store-then-render split as
`library_topic_members`. A model reading the two real captures offers *"bouncing back from a rough
race"*; the pure counting it replaced offered a bare surname lifted out of two titles.

**Cost is bounded by staleness, not by capture rate.** The bot triggers the pass after a capture
confirm, and a target whose live set was generated inside the last six hours is skipped. A burst of
saves costs one pass. `library-suggest` itself runs with `staleAfterMs: 0`, since running it by hand
means "I want the answer now".

**Dismissal persists and is fed back.** `dismissed_at` rows go into the next prompt as
*already turned down, never propose again* — otherwise the same card returns every week and becomes
a chore. `accepted_at` is a **separate** column on purpose: only a real rejection may teach the
prompt to stop, and an accepted title is already covered by the "already exists" list.

**Accepting creates it EMPTY.** No backfill and no second model call — what belongs to a new topic
is decided at capture time from then on, exactly as for a topic made through the bot.

`library_suggestions` carries an owner INSERT policy, which `library_sources` and
`bot_preview_jobs` deliberately do not. Those hold fetched third-party content and a staged write,
so service-role-only is a real boundary there. A suggestion is inert data about the user's own
library; the policy is what lets `e2e/library-suggestions.spec.js` seed cards and test the panel
with no model call anywhere.

### Where things live

| Concern | File |
|---|---|
| Capture page construction (pure) | `supabase/functions/_shared/libraryPage.ts` |
| Catalog / Lately / Activity rendering (pure) | `supabase/functions/_shared/libraryCatalog.ts` |
| Third-party content fencing (pure) | `supabase/functions/_shared/externalContent.ts` |
| Bot-side capture, topics, revert | `supabase/functions/telegram-bot/library.ts` |
| Network client for the extractor | `supabase/functions/telegram-bot/fetchSource.ts` |
| Attaching pasted text later | `supabase/functions/telegram-bot/libraryAttach.ts` |
| Rebuild: topics, front pages, Lately, Activity (pure-ish) | `supabase/functions/_shared/libraryRebuild.ts` |
| Weekly cron shell for that rebuild | `supabase/functions/library-rebuild/index.ts` |
| Noticing pass: digest, prompt, parse, run (pure-ish) | `supabase/functions/_shared/librarySuggest.ts` |
| Shell for that pass, and the by-hand entry point | `supabase/functions/library-suggest/index.ts` |
| Claude client, shared by the bot and the pass | `supabase/functions/_shared/anthropic.ts` |
| The card grid and its slot maths | `src/components/app/LibrarySuggestions.jsx`, `src/utils/librarySuggestions.js` |
| Loading, dismissing, accepting a suggestion | `src/hooks/useLibrarySuggestions.js` |
| Naming a topic or section yourself | `src/components/app/NewLibraryThingModal.jsx` |
| Sidebar shape: hoisting, home suppression | `src/utils/libraryTree.js` |
| Which roles are rows, and what a section opens | `src/utils/sectionPages.js` |
| Page-row markup and its two badges | `src/components/app/TreePageRow.jsx` |
| Article extraction + podcast RSS | `api/fetch-source.js`, `api/_lib/{articleExtract,podcastFeed,podcastResolve,canonicalUrl}.js` |

`api/_lib/*.js` is plain JS, not the edge functions' TypeScript, for the reason stated in
`api/_lib/hydrateImages.js`: raw Node ESM can't resolve those modules. `vitest.config.js` includes
`api/**/*.test.js` so they are still unit-tested.

### The third trust boundary

`prompt.ts` used to name exactly two untrusted sources: tracker text and the user's own messages.
Fetched articles, RSS descriptions, and uploaded documents are a **third**, defended in three
layers:

1. Fenced in `<external_content>` tags, with escaped attributes (extends the `<tracker_data>`
   precedent).
2. A line in `BASE_PROMPT` naming them as data.
3. **Summarized in a separate Claude call with `tools: []`.** This is the layer that actually
   holds — a model that cannot call anything cannot be talked into calling something.

Not hypothetical: the user's own podcast feed contains a live injection attempt, used verbatim as
a test fixture in `externalContent.test.ts`.

### Environment variables

New for this feature, alongside the existing `RENDER_ENDPOINT_URL` / `RENDER_SHARED_SECRET` pair:

**Supabase edge function secrets** (`supabase secrets set …`):
- `FETCH_SOURCE_URL` — the deployed `api/fetch-source.js` URL
- `FETCH_SHARED_SECRET` — must match the Vercel side
- `LIBRARY_DRY_RUN=1` — makes `library-rebuild` **and** `library-suggest` report what they *would*
  write without writing. Mirrors `REMINDER_DRY_RUN`. Run either by hand with this set and read the
  output before applying the cron migration.

`library-suggest` needs no new secrets: it reuses `ANTHROPIC_API_KEY` and `CRON_SECRET`. It has no
cron of its own yet — the bot's post-capture stale-check covers it while the corpus is small, and a
cron migration is a one-liner later, following the same deploy-order precedent.

**Vercel environment variables:**
- `FETCH_SHARED_SECRET` — must match the Supabase side

### Deploy order

The cron migration is deliberately last, matching `20260809233309_schedule_bot_reminders.sql`:

1. Apply migrations `20260820151116` … `20260820151641`, then `20260820200000`
2. Deploy `api/fetch-source.js` (Vercel) and set `FETCH_SHARED_SECRET`
3. Deploy the `telegram-bot`, `library-rebuild`, and `library-suggest` edge functions, set their
   secrets
4. Invoke `library-rebuild` by hand with `LIBRARY_DRY_RUN=1`, read the output
5. Only then apply `20260820151700_schedule_library_rebuild.sql`

## Commands

- `npm run dev` - Start dev server (binds to 0.0.0.0 — accessible from phone on same network)
- `npm run build` - Production build
- `npm run test:unit` - Run Vitest unit tests
- `npm run test:e2e` - Run Playwright E2E tests
- `npm run test:e2e:ui` - Run Playwright E2E tests with UI

Bot commands: `/new`, `/think`, `/reminders`, `/blog`, `/library`.

## MCP Servers

`.mcp.json` is gitignored. Each machine needs its own copy. Required servers:

**Supabase** (project management, database queries):
```json
{
  "supabase": {
    "type": "http",
    "url": "https://mcp.supabase.com/mcp?project_ref=ogzpgnxmcifaqliuxxzu"
  }
}
```

**Playwright** (browser automation for fix-and-verify skill):
```json
{
  "playwright": {
    "command": "npx",
    "args": ["@playwright/mcp@latest"]
  }
}
```

New machine setup: create `.mcp.json` at the project root with both entries above inside `{ "mcpServers": { ... } }`.

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.
