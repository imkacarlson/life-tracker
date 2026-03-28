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

## Completed

**Spurious conflict from two-effect draft detection split**
**Completed:** v0.1.2.0 (2026-03-28)
Merged both effects into a single atomic effect and added content equality check. Also auto-clears stale same-content drafts from localStorage.
