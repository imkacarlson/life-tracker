# Changelog

All notable changes to life-tracker are documented here.
Format: [Semantic Versioning](https://semver.org/). Dates: YYYY-MM-DD.

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
