# Changelog

All notable changes to life-tracker are documented here.
Format: [Semantic Versioning](https://semver.org/). Dates: YYYY-MM-DD.

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
- `activeDraft` in `useTrackers` moved from `useMemo` to `useEffect`+`useState`; now also reacts to `activeTrackerServer?.updated_at` settling, fixing a race where fast navigation could arrive before the server row resolved
- `onUseDraft` conflict resolution handler now explicitly calls `editor.commands.setContent()` to match `onUseServer` — fixes editor not showing selected content after conflict resolution
- `navigateToHash` now logs `console.warn` when `resolveNavHierarchy` returns null instead of silently dropping the navigation

### Fixed
- Mobile E2E: `issue-77` draft-conflict modal no longer fails due to hash navigation drop on slow mobile networks (cache + `activeTrackerServer?.updated_at` dependency)
- Mobile E2E: `issue-84` orphaned image cleanup typing now targets first paragraph directly to avoid unreliable generic container click
- Toolbar `pointer-events` bug affecting click-through in certain mobile scroll positions
- Multiple flaky E2E selectors hardened with behavioral assertions (`getByRole`/`getByText`)
