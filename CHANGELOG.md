# Changelog

All notable changes to life-tracker are documented here.
Format: [Semantic Versioning](https://semver.org/). Dates: YYYY-MM-DD.

## [0.5.0.0] - 2026-08-20

### Added
- **Library notebook** — a home for things the user runs across and wants to find again months
  later, alongside the monthly trackers that hold things with a lifespan. Follows the pattern
  Karpathy described in April 2026 (raw sources kept immutably, an LLM maintaining index pages
  over them, questions asked against the whole thing), narrowed to one job: **recall, not
  synthesis**. Topic pages catalog what was saved, in the user's own words, with dates. They never
  assert a conclusion.
- `library` notebook type, alongside `tracker` and `recipes` — one widened check constraint,
  following the recipes precedent
- `pages.library_role` (`capture` | `topic` | `section_index` | `lately` | `activity`) — the
  discriminant for tree filtering and rebuild scoping. Null for every page that already existed
- `library_sources` table — the immutable ingest record per capture: extracted text, provenance,
  extraction status, and a `canonical_url` whose partial unique index *is* the "already have this
  one" check
- `save_to_library` Telegram tool, beside `propose_tracker_addition` and gated the same way. The
  model routes between them on one question — is this something to **do**, or something to
  **remember**? A URL is explicitly not a signal
- `api/fetch-source.js` — a Vercel function that turns a share into a capture's raw material:
  `defuddle` + `linkedom` for articles, with a headless-Chrome retry for JS-rendered pages, and an
  iTunes-Search → RSS path for podcasts that works from any podcast app
- Podcast resolution keyed on the feed and episode rather than the share URL, so the same episode
  shared from Apple, Spotify, Overcast, or Podcast Addict is recognized as one thing
- Full-text search over pages and stored source text: generated `tsvector` columns, GIN indexes,
  and one `search_library` SQL function. **The tracker is now searchable too**, which falls out of
  the same index for free
- `search_library` bot tool — answers "I know I saved something about X, what was it?". Returns
  titles, snippets, and links, never full source text: narrowing in Postgres before the model sees
  anything is the whole cost story
- `library_topic_members` — stored topic membership, decided at capture time and at topic creation,
  never on a schedule
- `create_library_topic` tool, callable only when the user asks. The model may *suggest* a topic;
  it never creates one
- `library-rebuild` edge function + weekly cron — rebuilds topic catalogs, section front pages, and
  Lately, scoped to sections that actually received something, with every skip logged
- `library_activity` + `revert_library_page` tool — an append-only record of what the model changed
  and a one-step undo. Safe unconditionally, because only model-owned pages are ever rewritten
- `/library` bot command — what the rebuild last changed, pure reads, zero AI
- New-notebook dialog with a kind picker (Tracker / Recipes / Library)
- The bot's first non-text handlers: a `.txt` document quote-replied to a saved item attaches its
  full text (for paywalled sources a server fetch can't read), and photos/voice/video now get a
  reply instead of silence

### Changed
- `prompt.ts` now names a **third** untrusted source. It previously named two — tracker text and
  the user's own messages. Fetched articles, feed descriptions, and uploaded documents are a new
  category, fenced in `<external_content>` tags and summarized in a separate Claude call with no
  tools at all. Not hypothetical: the user's own podcast feed carries a live injection attempt
- `activeNotebookType` is now the single discriminant for notebook-kind behavior; `isRecipesNotebook`
  is retired
- `sendReply` returns the sent message id, so a capture's confirmation can be quote-replied to later
- `bot_preview_jobs` gains a `kind` column and nullable OCC columns, with a check constraint so only
  a library capture may have no target page

### Security
- `search_library` is `SECURITY INVOKER`, not `SECURITY DEFINER`. The first version combined
  `SECURITY DEFINER` with a `p_user_id` parameter on a PostgREST-exposed function, which meant any
  caller holding the (client-bundled, therefore public) anon key could have read any user's pages
  and stored source text by passing their id. RLS on `pages` and `library_sources` already does the
  scoping; the service role still bypasses it as before, so `p_user_id` is now an ordinary filter
  rather than an authorization bypass. Caught by the Supabase security advisor
- `page_plain_text` and `search_library` both pin `search_path`

### Removed
- The Recipes auto-provisioning effect. It hardcoded one type, one title, and one section name,
  fired only when `notebooks.length > 0` (so it never ran on a genuinely empty account), and
  swallowed errors. Notebook kinds are now chosen in the New Notebook dialog

### Fixed
- Capture pages never appear in the sidebar tree, but remain fully openable from a topic page,
  search, a deep link, or a citation. Filtering happens where the tree renders — the cache accessor
  is untouched, because filtering there would make a capture impossible to open at all
- Sidebar drag-and-drop reads the same visible page list the tree renders, so drop indices can't
  drift

## [0.4.0.0] - 2026-04-10

### Added
- Mobile keyboard-aware toolbar: the formatting toolbar now lifts above the Android virtual keyboard when the editor is focused, making Bold, Italic, Heading, and all formatting buttons accessible while typing (#124)
- `useVirtualKeyboard` hook — imperative DOM-based keyboard tracking using `window.visualViewport` resize events; writes directly to toolbar and zoom badge refs for smooth per-frame animation without React re-renders
- Global E2E test teardown that purges all test-account data after each run, preventing data accumulation across CI runs

### Changed
- Editor bottom padding now tracks toolbar height dynamically via `ResizeObserver`, so content is never hidden behind the toolbar when it expands or collapses (find bar, table controls, AI groups)
- Toolbar position now re-syncs when the keyboard opens and closes (both via state transition and mid-session height changes)
- E2E test helpers: self-contained seed/teardown pattern (`countUserRows`, `listUserStoragePaths`, `purgeTestUserData`) for cleaner test isolation
- Several existing E2E specs migrated to the self-contained seeding pattern

### Fixed
- Toolbar would snap back to `bottom: 0` when the user tapped a toolbar button while the keyboard was open (focus event was re-capturing the shrunken viewport height as the baseline; now skipped when keyboard is already open)
- `editorPaddingBottom` was not updated when the keyboard opened without a toolbar height change, leaving editor content scrollable into the hidden keyboard zone
- Cleanup: orientation change `setTimeout`/`rAF` calls now properly cancelled on unmount; `visualViewport` and `window.resize` listeners no longer double-fire on modern Android browsers

## [0.3.0.0] - 2026-04-03

### Added
- Tree-style navigation sidebar replacing the old TopBar notebook dropdown, section tabs, and pages sidebar
- SlimHeader with breadcrumb trail (notebook / section / page) and hamburger toggle
- NavigationTree component with collapsible notebook > section > page hierarchy, chevron indicators, section color chips, and drag-to-reorder pages
- GearMenu dropdown (settings + sign out) replacing inline topbar buttons
- TreeContextMenu with rename, copy, move, and delete actions for notebooks, sections, and pages (pages now deletable from context menu)
- Sidebar collapse/expand toggle with localStorage persistence
- Mobile navigation drawer with slide-in animation, backdrop overlay, and sticky header

### Changed
- Sidebar moved from right side to left side of the workspace
- Sidebar resizer arrow keys corrected for left-side layout (ArrowRight now expands)
- Mobile layout uses fixed-position drawer instead of stacked sections below editor
- deleteTracker now accepts an optional tracker object argument with hardened type guard against React synthetic events

### Removed
- TopBar component (replaced by SlimHeader)
- SectionTabs component (sections now shown in NavigationTree)
- Sidebar component (replaced by NavigationTree)
- SectionContextMenu component (replaced by TreeContextMenu)

## [0.2.0.0] - 2026-04-02

### Added
- Sports score email notifications — polls ESPN every 15 minutes via pg_cron, emails results with sport-specific sender names (e.g., "MLB Scores", "NBA Scores")
- 9 tracked teams: Nationals, Pacers, Capitals, Commanders, Colts, IU Football, IU Men's Basketball, IU Women's Basketball, Washington Spirit
- AI game summaries via Gemini 2.5 Flash with Google Search grounding (record, standings, recent news, next game)
- Deduplication via unique constraint on (team_id, espn_game_id) — no duplicate emails on re-runs
- 7-day rolling cleanup of score_history and notification_log tables
- Supabase Edge Function `check-scores` with cron secret auth
- Database schema: sport_teams, score_history, notification_log tables with RLS policies
- pg_cron + pg_net migration for automated 15-minute polling schedule

## [0.1.3.0] - 2026-03-28

### Added
- Photo attachments in Paste Recipe modal — attach up to 5 images (camera, gallery, drag-and-drop, clipboard paste) that AI reads to extract and format recipes
- Client-side image resize utility (`imageResize.js`) — scales to max 1024px, JPEG 80% quality, base64 encoded
- Thumbnail grid with remove buttons, drop zone visual feedback, and 5-image cap with inline limit message
- Multimodal AI support across all 3 providers (Anthropic, OpenAI, Google) — images sent as base64 alongside text
- Server-side image validation: media type allowlist (jpeg/png/webp), per-image 500KB limit, base64 format check
- Unit tests for `resizeAndEncode` utility (5 tests covering output shape, scaling, error paths)
- Mobile-responsive attachment UI (48px thumbnails, sticky action buttons, scrollable modal)

### Changed
- Paste Recipe modal description updated to mention photo support
- Edge function accepts optional `images` array alongside `text` (backward compatible — text-only still works)
- System prompt updated to handle image-based recipe input
- Unit test count: 84 → 89 (+5 imageResize tests)

## [0.1.2.0] - 2026-03-28

### Fixed
- Conflict modal no longer flashes briefly after every save (issue #99) — merged two React effects into one atomic effect so draft-read and conflict-detect always use the same draft snapshot
- `detectConflict` now compares content before timestamps — stale drafts with identical content no longer trigger false conflict modals
- Stale same-content drafts are automatically cleared from localStorage on page load, preventing "Unsaved (local)" status from persisting and localStorage quota leaks

### Changed
- Unit test count: 63 → 84 (+21 tests, including 5 new content-equality cases for `detectConflict`)

## [0.1.1.0] - 2026-03-26

### Added
- Mobile pinch-to-zoom for editor content area via CSS `zoom` on `.editor-shell` (issue #32)
- Zoom indicator badge: pill-shaped, bottom-right, tap to reset — follows DESIGN.md spec
- First-use hint tooltip when a wide table is detected on a touch device
- `useContentZoom` hook with imperative rAF-throttled gesture handling and midpoint scroll anchoring
- Zoom math utilities (`zoomHelpers.js`) with 10 unit tests covering distance, midpoint, clamping, and scroll anchoring
- Multi-touch guard in `mobileLongPressSelect` to suppress long-press during pinch gestures

## [0.1.0.0] - 2026-03-26

### Added
- Design system: CSS custom properties for color palette, typography scale (Instrument Sans + Geist Mono), and spacing — all UI components now use design tokens from `DESIGN.md`
- Life Tracker brand mark (SVG logo) replacing Vite placeholder
- Collapsible mobile toolbar: starts expanded, collapses to a single row on tap; touch-friendly targets throughout
- Vitest unit test layer: 63 tests across 6 files covering `contentHelpers`, `imageCleanup`, `navigationHelpers`, `listHelpers`, `draftHelpers`, and the new `resolveNavHierarchy` cache
- Two-layer CI: unit tests run first (fast gate), then E2E Playwright on Desktop + Mobile Chrome
- `resolveNavHierarchy` session cache: navigating back to a visited page no longer requires a Supabase round-trip — eliminates mobile silent navigation drops caused by network latency
- `clearNavHierarchyCache()` called on sign-out and on notebook/section/page deletion to prevent stale cache entries

### Changed
- `activeDraft` in `usePages` moved from `useMemo` to `useEffect`+`useState`; now also reacts to `activePageServer?.updated_at` settling, fixing a race where fast navigation could arrive before the server row resolved
- `onUseDraft` conflict resolution handler now explicitly calls `editor.commands.setContent()` to match `onUseServer` — fixes editor not showing selected content after conflict resolution
- `navigateToHash` now logs `console.warn` when `resolveNavHierarchy` returns null instead of silently dropping the navigation

### Fixed
- Mobile E2E: `issue-77` draft-conflict modal no longer fails due to hash navigation drop on slow mobile networks (cache + `activePageServer?.updated_at` dependency)
- Mobile E2E: `issue-84` orphaned image cleanup typing now targets first paragraph directly to avoid unreliable generic container click
- Toolbar `pointer-events` bug affecting click-through in certain mobile scroll positions
- Multiple flaky E2E selectors hardened with behavioral assertions (`getByRole`/`getByText`)
