# TODOS

## Navigation / Architecture

**Route-native navigation**
**Priority:** P2
Replace hash → `resolveNavHierarchy` (async Supabase lookup) with page identity stored in route state. Eliminates the Supabase call from the critical navigation path entirely; improves cold-start reliability on slow networks.
*Deferred from: PLAN.md (feature/design-system-overhaul)*

## Editor / Conflict

**Conflict modal accessibility**
**Priority:** P3
Add focus trap and keyboard dismiss (Escape key) to `ConflictModal`. Currently focus is not moved to the modal on open and there is no keyboard close path.
*Deferred from: PLAN.md (feature/design-system-overhaul)*

**Conflict detection telemetry**
**Priority:** P2
Log when a draft conflict is detected and when it is resolved (server vs draft choice). Helps diagnose future data-loss incidents in the field.
*Deferred from: PLAN.md (feature/design-system-overhaul)*

## Cache / Data

**Navigation cache invalidation on page section move**
**Priority:** P3
If a page-move-to-section feature is ever added, `pageHierarchyCache` entries will become stale. Add cache busting by `sectionId` or invalidate the affected entry on page update.
*Deferred from: PLAN.md (feature/design-system-overhaul)*

## Testing

**Issue #88: Migrate E2E tests to self-contained seed data**
**Priority:** P1
E2E tests currently depend on fragile shared seed data. Migrate to self-contained per-test setup using Supabase API helpers and the `isolateSupabaseData` fixture.
*Tracked in: GitHub issue #88*

## Recipe Inserter

**URL paste / web clipper for recipes**
**Priority:** P3
Detect pasted URLs in the Paste Recipe modal, fetch and extract recipe content. High risk due to CORS and scraping reliability — needs separate design.
*Deferred from: recipe photo attachments plan*

**PDF recipe support**
**Priority:** P3
Accept PDF files in the Paste Recipe modal. Requires PDF-to-image conversion before sending to AI.
*Deferred from: recipe photo attachments plan*

**E2E tests for recipe photo attachments**
**Priority:** P2
Add Playwright E2E tests for attach/remove/thumbnail flows in the Paste Recipe modal (`e2e/paste-recipe-attachments.spec.js`).
*Deferred from: recipe photo attachments plan*

## Mobile UX

**Haptic feedback on mobile toolbar buttons**
**Priority:** P3
Add `navigator.vibrate(10)` (or equivalent) on toolbar button tap for native-feeling response. Out of blast radius for issue #124 keyboard fix.
*Deferred from: PLAN.md (issue/124-keyboard-toolbar), CEO phase*

**Mobile role definition: full authoring vs capture/triage**
**Priority:** P2
Strategic question: should mobile be a full authoring environment (current direction) or a lightweight capture/triage tool? Codex flagged this during #124 planning as relevant to long-term UX direction. Worth a dedicated office-hours session before any large mobile-specific feature work.
*Deferred from: PLAN.md (issue/124-keyboard-toolbar), CEO phase*

**Samsung DEX / Gboard floating keyboard edge case**
**Priority:** P3
`useVirtualKeyboard` focus gate reduces false positives but does not fully handle Samsung DEX or Gboard floating keyboard (both can change visual viewport without a real keyboard appearing). Documented known limitation. Consider adding a user-dismissible "toolbar stuck?" nudge if it causes real-world pain.
*Deferred from: PLAN.md (issue/124-keyboard-toolbar), Eng phase*

## Completed

**Spurious conflict from two-effect draft detection split**
**Completed:** v0.1.2.0 (2026-03-28)
Merged both effects into a single atomic effect and added content equality check. Also auto-clears stale same-content drafts from localStorage.
