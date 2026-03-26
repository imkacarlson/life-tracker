<!-- /autoplan restore point: /home/imkacarlson/.gstack/projects/imkacarlson-life-tracker/feature-design-system-overhaul-autoplan-restore-20260326-123655.md -->
# Plan: Fix Mobile Draft-Conflict / Page-Load Instability (Issue #77)

## Context
- **Branch:** `feature/design-system-overhaul`
- **PR:** #95
- **Failing CI run:** 23573560787 (Mobile Chrome E2E only)
- **Spec:** `e2e/issue-77-draft-conflict-resolution.spec.js`

## Already Fixed
- `issue-84` T2 stabilized in `6a8b35e` — mobile typing reliability in the editor

## Problem Statement

On mobile, the issue-77 draft-conflict resolution E2E test fails intermittently with three
distinct failure modes:
1. The conflict modal never appears (most common)
2. The app lands on the wrong page title after hash navigation
3. The title is correct but the editor body is empty

These failures indicate the app itself is unstable on mobile cold-start — the draft-conflict
logic has no fair chance to run because page/content/draft state is not coherent.

## Root Cause Hypothesis

Mobile cold-start navigation or editor hydration races with draft detection. Specifically:

1. **Hash → hierarchy resolution:** On first load with `#pg=<id>`, `syncInitialHash` in
   `useNavigation.js` must call `resolveNavHierarchy` (a Supabase query) to get the full
   `notebookId/sectionId/pageId` triplet. Meanwhile, `useNotebooks` and `useSections`
   may settle before the async resolution completes, landing on default selections.

2. **pendingNavRef timing gap:** `setPendingNavSafely` sets `pendingNavRef.current` inside
   `syncInitialHash` — but `loadTrackers` in `useTrackers` reads `pendingNavRef.current`
   at call time. If `loadTrackers` fires before `syncInitialHash` resolves, `pending` is
   null and the section's first page (not the target page) is selected.

3. **Draft detection depends on `activeTrackerServer`:** `detectConflict` runs in a
   `useEffect` that depends on `[activeTrackerId, activeTrackerServer, activeDraft]`.
   If `activeTrackerId` is set correctly but `activeTrackerServer` hasn't arrived yet
   (because `trackers` state update hasn't rendered), the effect fires with
   `activeTrackerServer = null` → no conflict detected → modal never shown.

4. **Hash navigation mid-session (test's nav-back):** After navigating away and back
   via `window.location.hash`, `hashchange` fires `navigateToHash`. This sets
   `activeTrackerId` immediately if the page is already in `trackers`. But if mobile
   rendering is slow and `trackers` state is stale, the page might not be found.

## Affected Files

- `src/hooks/useNavigation.js` — initial hash resolution and hashchange handling
- `src/hooks/useTrackers.js` — page selection in `loadTrackers`, draft conflict detection
- `e2e/issue-77-draft-conflict-resolution.spec.js` — test setup and assertions

## Investigation Plan

1. Reproduce `issue-77` on Mobile Chrome only, single worker, repeated runs
2. Add targeted console logging to identify first bad state:
   - Requested pageId from hash
   - `pendingNavRef.current` when `loadTrackers` runs
   - `activeTrackerId` when conflict detection runs
   - `activeTrackerServer` (null vs populated) when conflict detection runs
   - Draft presence in localStorage at that moment
3. Fix the first bad state found (likely: `pendingNavRef` race in `loadTrackers`)
4. If page selection is stable, verify conflict modal appears reliably
5. Remove logging, stabilize the test

## Proposed Fixes (Candidates)

### Fix A: Guard `loadTrackers` page selection on resolved hash
In `loadTrackers`, if `pendingNavRef.current` is null but there's a hash with `#pg=`,
wait/retry briefly before defaulting to first page.

### Fix B: Re-detect conflict on `trackers` arrival
Make the `detectConflict` effect more robust by ensuring it re-fires when `trackers` state
populates even if `activeTrackerId` didn't change.

### Fix C: Test-side: wait for `trackers` to include the target page before asserting modal
Instead of waiting for `.conflict-modal` immediately after hash navigation, first verify
the editor shows the page's server content, then check for the modal. This makes the test
more resilient to the hydration race without needing app-side fixes.

## Success Criteria
- `issue-77` passes 10/10 repeated Mobile Chrome runs (single worker)
- Desktop runs unaffected
- No new flakiness introduced in other specs
- CI passes on `feature/design-system-overhaul` PR #95

---

## /autoplan Review (2026-03-26)

### Mode: HOLD SCOPE (bug fix — minimal diff, no scope expansion)

### Decision Audit Trail

| # | Phase | Decision | Principle | Rationale | Rejected |
|---|-------|----------|-----------|-----------|----------|
| 1 | CEO | HOLD SCOPE mode | P3+P6 | Bug fix — minimal change, bias toward action | SELECTIVE EXPANSION |
| 2 | CEO | Fix C (test-side modal wait) REJECTED | P1+P5 | Masks real detection race from CI; explicit over clever | Fix C as described |
| 3 | CEO | Fix B ("re-detect on trackers arrival") RENAMED | P5 | Already implemented via useMemo deps; rename to avoid confusion | Full re-implementation |
| 4 | CEO | Architectural reframing (readiness gates) DEFERRED | P3+P6 | Out of scope for bug fix PR; goes to TODOS.md | In-scope expansion |
| 5 | CEO | Branch scope concern NOTED, not actioned | P6 | Solo repo, bias toward action; note only | Branch split |
| 6 | Eng | Add hierarchy resolution cache | P5+P1 | Targeted fix that eliminates Supabase round-trip on nav-back | More invasive approaches |
| 7 | Eng | Test fix: nav-back retry in setupConflict | P5 | Mirrors waitForApp robustness; not masking modal bug | Raw hash set only |

---

## Phase 1 — CEO Review

### System Audit

**Hot files (30 days):** `useTrackers.js` (8), `issue-77` spec (6), `EditorPanel.jsx` (6), `useEditorSetup.js` (5) — high regression risk. The `issue-77` spec touched in 2 prior stabilization commits (`89df597`, `c04ed0f`) — recurring problem, architectural smell.

**Retrospective:** Multiple "fix: stabilize" commits across the branch. Areas that were previously problematic (`useNavigation`, `useTrackers`, `issue-77` spec) are the same areas this plan touches. This confirms the timing coordination between these three files is structurally fragile.

### Step 0A — Premise Challenge

| Premise | Status | Evidence |
|---------|--------|----------|
| P1: Root cause is app-level | PARTIAL | `navigateToHash` silent drop is confirmed app-level (line 79). But test's nav-back is also brittle. Both need fixing. |
| P2: resolveNavHierarchy can fail silently | CONFIRMED | Line 79: `if (!resolved?.notebookId) return` — zero retry, zero error log, zero fallback. Network failure on mobile = silent navigation drop. |
| P3: waitForApp uses mid-session navigation | CONFIRMED | `waitForApp` does `page.goto('/')` then sets hash via evaluate. `syncInitialHash` sees empty hash, returns immediately. Navigation is hashchange-driven, not cold-start. |
| P4: Fix app-side first | PARTIAL | Nav silent drop should be fixed. But test-side nav-back is also fragile and can be fixed independently without risk. |

**New premise (from code reading):** `resolveNavHierarchy` is called on EVERY hashchange for EVERY page navigation — including mid-session nav-back to an already-visited page. There is no cache. On mobile (200-800ms Supabase latency), this is the critical path that fails.

### Step 0B — Existing Code Leverage

| Sub-problem | Existing code |
|-------------|---------------|
| Hierarchy resolution | `resolveNavHierarchy()` in `src/utils/resolveNavHierarchy.js` |
| Navigation version control | `navVersionRef` in `useNavigation.js` — already prevents stale navigations |
| Draft conflict detection | `detectConflict()` in `src/utils/draftHelpers.js` — pure function, unit-tested |
| Draft read on page switch | `activeDraft useMemo` with `[activeTrackerId, draftInvalidation]` deps — already re-reads on switch |
| Test navigation helper | `waitForApp()` in `e2e/test-helpers.js` — has fallback but not used in nav-back |

### Step 0C — Dream State Mapping

```
CURRENT STATE              THIS PLAN                  12-MONTH IDEAL
───────────────            ──────────────             ───────────────
navigateToHash hits         Add hierarchy cache →       Route-native navigation
Supabase on every          nav-back = instant +         (hash → page ID stored
hash change →              no network failure risk      in URL, hierarchy resolved
mobile silent failures →                               once at boot, never again
test flakes              Test nav-back uses             on navigation); conflict
                         waitForApp robustness          detection has telemetry
                                                        for missed conflicts
```

### Step 0C-bis — Implementation Alternatives

```
APPROACH A: Hierarchy resolution cache (CHOSEN)
  Summary: Cache resolveNavHierarchy results per pageId in a module-level Map.
           Nav-back to a visited page = instant, no network.
  Effort:  S (1 file: resolveNavHierarchy.js + ~15 lines)
  Risk:    Low (cache is read-only; stale data worst case = uses page hierarchy
               that hasn't changed — hierarchy is stable for a page's lifetime)
  Pros:    - Eliminates Supabase round-trip on every hashchange
           - Fixes the mobile failure without touching navigation logic
           - No API changes
  Cons:    - Cache doesn't invalidate if page moves sections (rare edge case)
  Reuses:  resolveNavHierarchy.js (modify in-place)

APPROACH B: Pass trackers/sections to useNavigation, use in-memory fallback
  Summary: When resolveNavHierarchy returns null, look up page in trackers state.
  Effort:  M (3 files: useNavigation.js, App.jsx, useSections.js)
  Risk:    Medium (increases hook coupling; sections must be passed through)
  Pros:    - Always uses fresh in-memory data
  Cons:    - Increases coupling significantly
           - API breaking change for useNavigation
  Reuses:  trackers state already in memory

APPROACH C: Retry in resolveNavHierarchy
  Summary: On network error, wait 500ms and retry once before returning null.
  Effort:  S (1 file: resolveNavHierarchy.js + ~10 lines)
  Risk:    Low-Medium (adds latency on real failure; may hide errors)
  Pros:    - Handles transient mobile network failures
  Cons:    - Masks errors; doubles latency on real failures
           - Doesn't help if Supabase is slow (not erroring)
  Reuses:  resolveNavHierarchy.js

RECOMMENDATION: Approach A. Targeted, minimal diff, no coupling increase.
For the test: add nav-back retry (analogous to waitForApp fallback) as a separate fix.
```

### Step 0D — HOLD SCOPE Analysis

Complexity check: Plan as written touches 3 files (`useNavigation.js`, `useTrackers.js`, spec). With the revised approach (Approach A + test fix), it touches 2 files: `resolveNavHierarchy.js` and the spec. Well within HOLD SCOPE bounds.

Minimum set of changes: `resolveNavHierarchy.js` cache + spec nav-back retry. Fix A (loadTrackers guard) and Fix B (re-detect, already done) are NOT needed.

### Step 0E — Temporal Interrogation

```
HOUR 1 (investigation): Add console logs to navigateToHash (before/after resolveNavHierarchy),
  to activeDraft useMemo, and to detectConflict useEffect. Run issue-77 Mobile Chrome ×5.
  Find which log line shows the first bad state. (With CC: ~10 min)

HOUR 2 (resolution cache): Add module-level Map to resolveNavHierarchy.js.
  Cache successful resolutions. Clear on auth change (session effect in App.jsx).
  (With CC: ~15 min)

HOUR 3 (test fix): In setupConflict, replace raw page.evaluate hash set with a
  robust nav helper that retries on failure. Add the waitForApp fallback pattern.
  (With CC: ~10 min)

HOUR 4 (verify): Run issue-77 Mobile Chrome ×10, single worker. Verify 10/10.
  Run full E2E suite to check for regressions. (With CC: ~15 min test run)

HOUR 5+ (edge cases): What if the page is deleted between cache population and nav?
  Cache must not prevent navigateToHash from failing gracefully (it won't: cache
  just provides the hierarchy, the actual page selection still validates against trackers).
```

**Critical ambiguity the implementer will hit:** Should the cache be in the `resolveNavHierarchy` module (persistent across renders) or in `useNavigation` as a ref (reset on remount)? Module-level is simpler and correct — the hierarchy for a page ID never changes within a session.

### CEO Review Sections

**Section 1 — Architecture:**

```
CURRENT NAVIGATION ARCHITECTURE

  hashchange event
       │
       ▼
  navigateToHash()
       │
       ▼
  resolveNavHierarchy({ pageId }) ──────────▶ Supabase query (200-800ms mobile)
       │                                              │
       │  success                    failure/timeout  │
       │◀─────────────────────────────────────────────┘
       │                             │
       ▼                             ▼
  setActiveTrackerId()          ← LINE 79: SILENT RETURN ←── CRITICAL GAP
                                    (no retry, no log, no fallback)
```

**After fix:**
```
  resolveNavHierarchy({ pageId })
       │
       ├─▶ Check cache (Map) ──── HIT ──▶ Return cached result (instant)
       │
       └─▶ MISS ──▶ Supabase query ──▶ Cache result, return
                              │
                              └─▶ FAIL ──▶ return null (navigateToHash returns, logs error)
```

Coupling concerns: None added. Rollback: revert resolveNavHierarchy.js (single file).

**Section 2 — Error & Rescue Map:**

```
METHOD/CODEPATH                    | WHAT CAN GO WRONG          | CLASS
──────────────────────────────────|----------------------------|-----------
resolveNavHierarchy (pageId path)  | Supabase network error     | Network error
                                   | Supabase timeout (mobile)  | Timeout
                                   | Page not found (deleted)   | RecordNotFound
navigateToHash                     | Version mismatch (stale)   | Logic race
                                   | resolveNavHierarchy null   | Silent drop

EXCEPTION                     | RESCUED? | ACTION              | USER SEES
------------------------------|----------|---------------------|----------
Supabase network error         | Partial  | resolveNavHierarchy returns null → navigateToHash returns | Nothing (silent!) ← GAP
Supabase timeout               | Partial  | Same as above       | Nothing (silent!) ← GAP
Version mismatch (navVersion)  | Yes      | Return early; new nav takes over | Correct behavior
Page deleted (resolves null)   | Yes (after fix) | Cache miss → null → log warning | Nothing (correct — page gone)
```

**CRITICAL GAP:** When `resolveNavHierarchy` fails (network/timeout on mobile), `navigateToHash` returns at line 79 with zero logging and zero user feedback. The cache fix prevents most of these failures for repeat navigations. But first navigation to a page on bad mobile network still silently fails. Add `console.warn` at line 79 minimum.

**Section 3 — Security:** No new attack surface. Hash parsing already sanitized via `parseDeepLink`. Resolution cache keys are UUIDs from controlled navigation. No injection vectors. No new auth boundaries. **OK.**

**Section 4 — Data Flow & Interaction Edge Cases:**

```
INTERACTION                    | EDGE CASE                    | HANDLED?
-------------------------------|------------------------------|----------
Navigate to page via hash      | resolveNavHierarchy fails    | NO ← GAP (fix: cache)
Navigate back to known page    | Cache hit, no Supabase call  | YES (after fix)
Draft injected while on page B | activeDraft re-reads on nav  | YES (activeTrackerId in useMemo deps)
Conflict detected late         | detectConflict effect re-runs| YES (activeTrackerServer in deps)
resolveConflictWithServer      | Editor shows draft content   | NEEDS INVESTIGATION
  clicked                      | after conflict cleared       | (stale useLayoutEffect ref?)
useLayoutEffect reads stale    | activeTrackerRef.current =   | POTENTIAL BUG
  activeTrackerRef             | prev tracker content on      | (see note below)
                               | activeTrackerId change       |
```

**Note on useLayoutEffect stale ref:** In `useEditorSetup.js`, `useLayoutEffect` depends on `activeTrackerId` but reads `activeTrackerRef.current` which is updated by a `useEffect` (passive, runs after layout effects). This means on the first render after `activeTrackerId` changes, `useLayoutEffect` reads the PREVIOUS tracker's content. However, the content comparison (`if (JSON.stringify(currentContent) === rawContent)`) handles this by checking if the editor already shows the right content. This likely works on desktop but the exact mechanism needs verification. Flagged for investigation but not a blocker for this plan.

**Section 5 — Code Quality:**

Fix candidates A/B/C in the plan contain dead candidates. After analysis:
- Fix B is already implemented (detectConflict deps are correct)
- Fix C (test modal wait) should be removed
- Fix A (loadTrackers guard) is over-engineered for the actual failure mode

Plan simplification needed: collapse to 2 targeted fixes. **WARNING.**

**Section 6 — Test Review:**

```
NEW UX FLOWS: None (bug fix only)

NEW CODEPATHS:
  - resolveNavHierarchy cache lookup (before Supabase query)
  - Cache population on successful resolution
  - Cache miss → Supabase path (existing behavior)

NEW ERROR/RESCUE PATHS:
  - console.warn when navigateToHash line 79 is hit (new logging)

EXISTING PATHS BEING FIXED:
  - Mobile: resolveNavHierarchy fails → navigateToHash silent drop → conflict never shown
```

| Item | Test type | Exists? | Gap |
|------|-----------|---------|-----|
| Cache hit (pageId already visited) | Unit | No | Write unit test for `resolveNavHierarchy` with populated cache |
| Cache miss → Supabase | Integration (E2E) | Yes (existing issue-77) | Cover via E2E |
| Supabase failure → null | Unit | No | Test resolveNavHierarchy returns null on error |
| Nav-back to testPage stable | E2E Mobile | issue-77 (after fix) | Covered |
| Conflict modal after reliable nav | E2E Mobile | issue-77 (after fix) | Covered |

**2am Friday test:** "Mobile user has stale draft, navigates back via browser hash history — does the conflict modal appear?" → This is exactly the E2E test. After fix, it passes.

**Section 7 — Performance:**

Cache eliminates 1 Supabase round-trip per `#pg=<id>` hashchange for revisited pages. On mobile (200-800ms), this is a meaningful improvement. Cache size is bounded by number of pages visited in session (typically < 50). Memory impact negligible. **OK.**

**Section 8 — Observability:**

Gap: When `navigateToHash` hits line 79 (silent return), nothing is logged. This makes diagnosing future failures impossible. **Add `console.warn('[nav] resolveNavHierarchy returned null for hash=%s', hash)`.**

Gap: No logging for cache hits/misses. Add `console.debug('[nav:cache] hit/miss pageId=%s', pageId)` (debug level, stripped in prod).

**Section 9 — Deployment:**

Single-file change to `resolveNavHierarchy.js` + E2E spec change. No DB migrations. No deploy risk. Rollback: revert both files. **Low risk.**

**Section 10 — Long-Term Trajectory:**

This fix is reversibility 5/5 (single file, easily reverted). Technical debt: the hierarchy cache is a module-level singleton which works correctly but is a subtle pattern. Comment required. The 12-month ideal (route-native navigation) is deferred to TODOS.md. This fix is a stepping stone, not an obstacle, toward that ideal.

**Section 11 — Design & UX Review (UI scope detected: "modal", "nav"):**

```
INTERACTION STATE MAP:
  FEATURE               | LOADING | EMPTY | ERROR  | SUCCESS | PARTIAL
  ---------------------|---------|-------|--------|---------|--------
  Conflict modal        | No      | N/A   | No     | Yes     | No
  Nav to page          | Locked  | Empty | Silent | Heading | Empty editor?
  Conflict resolution   | No      | N/A   | No     | Saved   | N/A
```

**Gap 1:** Conflict modal has no loading state for "Use server version" — after click, there's a brief moment where `resolveConflictWithServer` runs but the modal disappears and the editor may show stale content. This is a cosmetic issue, not a blocker.

**Gap 2:** Navigation error state — when `navigateToHash` fails silently, user sees nothing (stays on wrong page). After this fix, mobile users on bad networks will still silently fail on first navigation to an unvisited page. A spinner or "loading..." in the page area would help, but this is out of scope.

DESIGN.md alignment: conflict modal uses existing modal classes (`ai-insert-modal`, `conflict-modal`). Typography follows Instrument Sans body pattern. Colors use stone palette. No deviation.

**NOT in scope:**
- Route-native navigation architecture
- Conflict modal loading state during resolution
- First-navigation failure UX (error message when resolveNavHierarchy fails)
- loadTrackers pendingNavRef guard (Fix A in original plan)
- Re-detecting conflict on `trackers` arrival (Fix B — already implemented)

**What already exists:**
- `resolveNavHierarchy.js` — will be modified in-place (add cache Map)
- `detectConflict()` — already correct, no changes needed
- `activeDraft useMemo` — already correct (re-reads on `activeTrackerId` change)
- `waitForApp()` — will be used as pattern for test fix

**Dream state delta:** After this plan, we're at "mobile nav-back is stable, conflict detection fires reliably." 12-month ideal adds telemetry for missed conflicts and route-native navigation.

**Error & Rescue Registry:**

```
METHOD                         | ERROR                  | RESCUED? | USER SEES     | LOGGED?
-------------------------------|------------------------|----------|---------------|--------
resolveNavHierarchy (pageId)   | Network error          | Partial  | Nothing       | No ← GAP
navigateToHash                 | resolveNavHierarchy=null| Partial  | Nothing      | No ← GAP (add warn)
navigateToHash                 | Version mismatch       | Yes      | Nothing (OK) | No
detectConflict effect          | null activeTrackerServer| Yes     | No modal (OK)| No
```

**Failure Modes Registry:**

```
CODEPATH                        | FAILURE MODE             | RESCUED? | TEST? | USER SEES? | LOGGED?
-------------------------------|--------------------------|----------|-------|------------|--------
navigateToHash (line 79)        | Silent drop on null      | N        | N     | Silent     | N ← CRITICAL
resolveNavHierarchy (network)   | Returns null             | N        | N     | Silent     | N ← CRITICAL
setupConflict nav-back          | Hash set, title never changes | N   | N     | Test times out | N
activeTrackerServer null at detection | No conflict shown   | Y (refire when data arrives) | Y | No modal (brief) | N
```

**CEO Completion Summary:**

```
+====================================================================+
|            MEGA PLAN REVIEW — CEO PHASE COMPLETION                 |
+====================================================================+
| Mode selected        | HOLD SCOPE (bug fix)                        |
| System Audit         | useTrackers hotspot; issue-77 recurring     |
| Step 0               | Approach A chosen; Fix C rejected           |
| Section 1  (Arch)    | 1 critical gap (line 79 silent drop)        |
| Section 2  (Errors)  | 4 error paths mapped, 2 CRITICAL GAPS      |
| Section 3  (Security)| 0 issues found                              |
| Section 4  (Data/UX) | 2 edge cases flagged, 1 confirmed handled   |
| Section 5  (Quality) | 1 warning (plan has dead candidates)        |
| Section 6  (Tests)   | 2 unit test gaps identified                 |
| Section 7  (Perf)    | 0 issues (cache is a perf improvement)      |
| Section 8  (Observ)  | 2 logging gaps found                        |
| Section 9  (Deploy)  | 0 risks (single-file, no migration)         |
| Section 10 (Future)  | Reversibility: 5/5, 1 TODOS item           |
| Section 11 (Design)  | 2 issues (minor, non-blocking)              |
+--------------------------------------------------------------------+
| NOT in scope         | written (5 items)                            |
| What already exists  | written                                     |
| Dream state delta    | written                                     |
| Error/rescue registry| 4 methods, 2 CRITICAL GAPS                  |
| Failure modes        | 4 total, 2 CRITICAL GAPS                    |
| TODOS.md updates     | 1 item (route-native nav)                   |
| Scope proposals      | 0 (HOLD SCOPE)                              |
| CEO plan             | skipped (HOLD SCOPE)                        |
| Outside voice        | ran (codex + claude subagent)               |
| Lake Score           | 5/6 chose complete option                  |
| Diagrams produced    | 2 (architecture, data flow)                 |
| Stale diagrams found | 0                                           |
| Unresolved decisions | 0                                           |
+====================================================================+
```

**Phase 1 complete.** Codex: 7 concerns. Claude subagent: 7 findings. Consensus: 2/6 confirmed (Fix C bad, alternatives unexplored). Key DISAGREE: Codex wants architectural reframing (deferred). Passing to Phase 2.

---

## Phase 2 — Design Review (UI scope: modal, nav)

**Scope rating: 2/10** — This is primarily a reliability fix. The conflict modal already exists. No new UI is being designed.

**Litmus scorecard (design dimensions):**

| Dimension | Score | Notes |
|-----------|-------|-------|
| Information hierarchy | 8/10 | Conflict modal clearly explains the choice |
| Missing states | 6/10 | No loading state during "Use server version" resolution |
| User journey | 8/10 | Detect → modal → choose → resolved. Clear arc |
| Specificity | 9/10 | No new UI components — existing modal reused |
| Interaction states | 7/10 | SUCCESS and EMPTY covered; ERROR (conflict detection fail) not shown |
| Responsive | 8/10 | Modal uses existing responsive pattern |
| Accessibility | 7/10 | Buttons are labeled, no explicit focus management on modal open |

**Design consensus:** Both voices agreed — no major design issues. The conflict modal is simple and correct. Gap: modal has no escape/keyboard dismiss. Gap: no focus trap (focus should land on first button when modal opens). These are accessibility concerns, not blockers for this fix.

**Auto-decided:** Accessibility gaps → TODOS.md (out of scope for reliability fix).

**Phase 2 complete.** 2 design findings (both non-critical, deferred). Passing to Phase 3.

---

## Phase 3 — Engineering Review

### Architecture ASCII Diagram

```
AFFECTED COMPONENT GRAPH (after fix)

  App.jsx
    │
    ├── useNavigation (reads: notebooks, sections, trackers ids)
    │     │
    │     └── navigateToHash()
    │           │
    │           └── resolveNavHierarchy()  ← MODIFIED
    │                 │
    │                 ├── cache Map (NEW) ──── HIT ──▶ return cached
    │                 │
    │                 └── MISS ──▶ supabase.from('pages').select(...)
    │                               │
    │                               ├── SUCCESS ──▶ cache + return
    │                               └── FAIL ──▶ return null (+ warn)
    │
    ├── useTrackers
    │     │
    │     ├── activeTrackerId (set by useNavigation via setActiveTrackerId)
    │     ├── activeTrackerServer (derived: trackers.find(id))
    │     ├── activeDraft (useMemo: readPageDraft on activeTrackerId change)
    │     └── detectConflict effect (deps: all three above)
    │
    └── useEditorSetup
          │
          └── useLayoutEffect (deps: activeTrackerId, NOT activeTracker)
                └── reads activeTrackerRef.current (may be stale by 1 render cycle)
                    ← KNOWN RISK: investigate separately if needed
```

**Coupling:** No new coupling introduced. `resolveNavHierarchy.js` is self-contained. Cache is module-level (transparent to callers).

### Test Diagram

```
EXISTING E2E PATHS COVERED (after fix):
  Mobile: navigate to page (cold-start hashchange path) ←── FIXED (cache on first nav)
  Mobile: navigate away (hashchange) ←── unchanged
  Mobile: inject draft ←── unchanged
  Mobile: navigate back (hashchange) ←── FIXED (cache hit = no network, instant)
  Mobile: conflict modal appears ←── FIXED (page nav reliable → detection fires)
  Mobile: "Use server version" ←── unchanged
  Mobile: "Use local version" ←── unchanged

NEW UNIT TEST PATHS NEEDED:
  - resolveNavHierarchy: cache hit returns immediately without Supabase
  - resolveNavHierarchy: cache miss calls Supabase and caches result
  - resolveNavHierarchy: Supabase error returns null (existing behavior, add test)
  - navigateToHash: logs warning when resolved is null (new logging)
```

### Concrete Implementation Plan

**Change 1: `src/utils/resolveNavHierarchy.js`** (~15 lines)

```js
// Add at top of file (module-level):
const hierarchyCache = new Map() // pageId → { notebookId, sectionId, pageId, blockId }

// In resolveNavHierarchy, for the pageId path:
if (pageId) {
  const cached = hierarchyCache.get(pageId)
  if (cached) return { ...cached, blockId: blockId ?? null }

  const { data, error } = await supabase.from('pages').select(...)
  if (error || !data?.section_id) {
    console.warn('[nav] resolveNavHierarchy failed for pageId=%s', pageId)
    return null
  }
  const result = { notebookId, sectionId, pageId, blockId: null }
  hierarchyCache.set(pageId, result)
  return { ...result, blockId: blockId ?? null }
}

// Export for cache clearing on auth change:
export const clearNavHierarchyCache = () => hierarchyCache.clear()
```

**Change 2: `src/App.jsx`** (~3 lines)

In the auth session effect, call `clearNavHierarchyCache()` on sign-out to prevent stale cache across sessions.

**Change 3: `e2e/issue-77-draft-conflict-resolution.spec.js`** (~15 lines)

In `setupConflict`, replace the raw `page.evaluate` hash navigation + immediate expect with a robust nav function that mirrors `waitForApp`'s retry pattern:

```js
// Before: raw hash set + 15s wait (fails silently if hashchange drops)
await page.evaluate((id) => { window.location.hash = '#pg=' + id }, testPage.id)
await expect(page.locator('.title-input')).toHaveValue('Conflict Test Page', { timeout: 15000 })

// After: robust nav with retry fallback
await page.evaluate(() => { window.location.hash = '' })  // clear first
await page.evaluate((id) => { window.location.hash = '#pg=' + id }, testPage.id)
try {
  await expect(page.locator('.title-input')).toHaveValue('Conflict Test Page', { timeout: 10000 })
} catch {
  // Fallback: full navigation (mirrors waitForApp pattern)
  await page.goto(`/#pg=${testPage.id}`)
  await page.waitForSelector('.app:not(.app-auth)', { timeout: 10000 })
  await expect(page.locator('.title-input')).toHaveValue('Conflict Test Page', { timeout: 10000 })
}
```

### Section 3 — Eng Test Review (Full)

```
NEW CODEPATHS:
  1. resolveNavHierarchy cache lookup (hit path)
  2. resolveNavHierarchy cache population (miss path)
  3. clearNavHierarchyCache() on sign-out
  4. console.warn in navigateToHash when resolved=null
  5. Test: setupConflict nav-back with retry

NEW UNIT TEST NEEDED:
  src/utils/__tests__/navigationHelpers.test.js
  - "resolveNavHierarchy caches results after first call"
  - "resolveNavHierarchy cache hit skips Supabase"
  - "resolveNavHierarchy returns null on Supabase error"

  OR: separate resolveNavHierarchy.test.js if it grows

NEW E2E COVERAGE:
  - issue-77 passing Mobile Chrome ×10 = sufficient coverage for the conflict flow

GAPS:
  - No unit test for cache behavior (NEW — write it)
  - No test for clearNavHierarchyCache on sign-out (manual verification sufficient for now)
```

**2am Friday test:** "Mobile user on 3G navigates back to a page they visited 5 minutes ago — does conflict detection fire?" → YES: cache hit, no Supabase call, `setActiveTrackerId` called immediately, detection fires with populated `activeTrackerServer`. ✓

**Chaos test:** Cache populated with page A, page A moved to different section (server-side). User navigates to page A via hash. Cache returns stale `sectionId`. `navigateToHash` sets `activeNotebookId` then `activeSectionId` (stale section) → `loadTrackers` loads wrong section. **This is a real edge case.** Mitigation: cache is session-scoped and sections can't be moved in the current app (no such feature exists per CLAUDE.md). Add TODO.

### Section 4 — Performance: Cache eliminates N Supabase round-trips per session (N = page navigations). No degradation. ✓

### Section 5 — Security: Cache is in-memory, cleared on sign-out. No persistence, no injection surface. ✓

**Eng Completion Summary:**

```
+====================================================================+
|            ENG REVIEW — COMPLETION SUMMARY                          |
+====================================================================+
| Architecture         | Diagram produced; no new coupling           |
| Test coverage        | 3 unit tests needed (resolveNavHierarchy cache)|
| Performance          | Cache = improvement (N fewer network calls) |
| Security             | 0 new risks                                 |
| Error paths          | 2 CRITICAL GAPS addressed (warn + cache)    |
| Deployment risk      | Low (2 files, no migration)                 |
+====================================================================+
```

**Phase 3 complete.** 3 unit test gaps identified. 2 CRITICAL GAPS addressed by fix. Eng review ready.

---

## Cross-Phase Themes

**Theme: Silent navigation failures on mobile** — flagged in CEO (line 79), Design (no error state), Eng (no logging). High-confidence signal. Fix addresses root cause (cache) + adds observability (warn log).

**Theme: Test setup robustness** — flagged in CEO (no retry in setupConflict) and Eng (test gap). Fix adds waitForApp-style retry to setupConflict nav-back.

---

## TODOS.md

1. **Route-native navigation architecture** — Replace hash → async hierarchy lookup with page identity stored in route state. Eliminates the Supabase critical path entirely. P2, L effort human / M with CC.
2. **Conflict modal accessibility** — Add focus trap and keyboard dismiss (Escape) to ConflictModal. P3, S effort.
3. **Stale cache on page section move** — If page section-move feature is ever added, cache must be invalidated. Add cache busting by sectionId. P3, S effort.
4. **Conflict detection telemetry** — Log when conflict is detected and when it's resolved (server vs draft). Helps diagnose future data loss incidents. P2, S effort.

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 2 | ISSUES_OPEN (HOLD_SCOPE via /autoplan) | 2 critical gaps (silent nav drop + no logging) |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | CLEAR (gate=pass) | 3 findings, 3 fixed (prior run) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 2 | ISSUES_OPEN (PLAN via /autoplan) | 5 issues, 2 critical gaps — implement fixes to clear |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR (PLAN via /autoplan) | 2 minor decisions (accessibility deferred to TODOS) |

**UNRESOLVED:** 0 open decisions (all auto-decided per 6 principles).
**VERDICT:** ISSUES_OPEN — implement the 3 changes (resolveNavHierarchy cache, App.jsx clearCache, spec retry), then eng review clears.
