<!-- /autoplan restore point: /home/imkacarlson/.gstack/projects/imkacarlson-life-tracker/main-autoplan-restore-20260409-192937.md -->
# Plan: Mobile Keyboard-Aware Toolbar (Issue #124)

## Problem Statement

On Android mobile, when the user taps into the Tiptap editor and the virtual keyboard appears, the bottom-fixed `.toolbar` is hidden behind the keyboard. There is no way to access formatting buttons (Bold, Italic, Heading, etc.) while typing. The keyboard and toolbar occupy the same screen region.

**User report:** "if I have my cursor on a line I can't [format text] and it brings up the keyboard on my phone. I'm not currently seeing the toolbar because the keyboard hides the toolbar."

## Goal

The formatting toolbar should remain visible and tappable **above the virtual keyboard** when the editor is focused on mobile. This is the standard pattern used by Notion, OneNote, Google Docs, and Bear Writer.

## Context

- **Branch:** `main`
- **Issue:** #124
- **Current toolbar:** `position: fixed; bottom: 0` on mobile (`responsive.css`)
- **Current mobile toolbar state:** collapsible (6 core buttons + expand toggle)
- **Design system:** DESIGN.md — warm industrial, teal accent, `--duration-medium: 300ms`
- **Touch detection:** `isTouchOnlyDevice()` in `src/utils/device.js`
- **Editor:** Tiptap (ProseMirror) in `EditorPanel.jsx`

## UX Interaction Spec

**The experience (not the implementation):**
1. User taps into paragraph → keyboard slides up → toolbar lifts above keyboard in sync, animated at `--duration-medium: 300ms` with `var(--ease-out)`. Feels native.
2. User taps Bold on the lifted toolbar → text becomes bold → keyboard stays open → cursor stays visible. No flicker, no refocus.
3. User taps outside editor → keyboard dismisses → toolbar animates back down to `bottom: 0` (same duration, same easing, symmetrical).
4. Toolbar expand/collapse toggle works while keyboard is open. Editor content area reflows when toolbar rows change.

**Interaction state map:**

| State | Toolbar position | Editor bottom padding | Notes |
|-------|-----------------|----------------------|-------|
| Keyboard closed | `bottom: 0` | 52px (1-row collapsed) | Default |
| Keyboard opening | tracks per rAF | tracks per rAF | Smooth chase, not snap |
| Keyboard open | `bottom: keyboardHeight + safeArea` | `keyboardHeight + currentToolbarHeight` | Dynamic |
| Toolbar expanded while keyboard open | same `bottom` | `keyboardHeight + expandedToolbarHeight` | Recomputes on toggle |
| Keyboard closing | tracks per rAF back to 0 | tracks back | Symmetrical |
| visualViewport unavailable | `bottom: 0` | 52px | Silent fallback |

**Focus and selection preservation:**
- Toolbar `onMouseDownCapture` calls `event.preventDefault()` on button taps → prevents editor blur → selection stays → formatting applies correctly. This is already implemented in `Toolbar.jsx:205`.
- The `editorCmd()` pattern in `Toolbar.jsx:92` already handles touch-mode: doesn't call `.focus()` when editor isn't focused, so no phantom keyboard opens.

**Quality bar:** Should feel indistinguishable from a native app keyboard accessory bar. The toolbar lifts with the keyboard, not after it.

## Root Cause

Android's Chrome browser does **not** resize the layout viewport (`window.innerHeight`) when the virtual keyboard appears — it shrinks only the **visual viewport** (`window.visualViewport.height`). The `.toolbar` is positioned relative to the layout viewport (`position: fixed; bottom: 0`), so when the keyboard takes the bottom half of the screen, the toolbar sits underneath it, invisible.

iOS Safari (12.2+) also implements `visualViewport`. Desktop never opens a virtual keyboard, so `keyboardHeight` is always 0.

## Solution: `visualViewport` API

Listen to `window.visualViewport` `resize` and `scroll` events to compute the keyboard height in real time, then apply it as an inline `bottom` offset to the toolbar DOM node.

```
keyboardHeight = window.innerHeight
               − window.visualViewport.height
               − window.visualViewport.offsetTop
```

When the keyboard is closed: `keyboardHeight = 0`, toolbar sits at `bottom: 0` (unchanged).
When the keyboard opens: `keyboardHeight = ~250–350px`, toolbar lifts above the keyboard.

## Implementation Plan

### Architecture: Imperative DOM (not React state)

Follows the `useContentZoom.js` pattern: apply DOM mutations directly during the animation, update React state only for open/close transitions. This prevents per-frame React rerenders through the large Toolbar prop surface.

```
Keyboard animation (per rAF):
  visualViewport event
    └─▶ toolbarRef.current.style.bottom = computedOffset + 'px'     [imperative]
    └─▶ toolbarRef.current.style.paddingBottom = '0'               [imperative]
    └─▶ zoomBadgeRef.current.style.bottom = badgeOffset + 'px'     [imperative]

Keyboard open/close (once, state update):
  keyboardOpen changes
    └─▶ setKeyboardOpen(true/false)                                 [React state]
    └─▶ useEffect → ResizeObserver → setEditorPaddingBottom         [React state]
```

### 1. New hook: `src/hooks/useVirtualKeyboard.js`

```js
// Imperative keyboard-height tracking. Writes directly to DOM refs.
// Only activates on focus-gated viewport changes (avoids false positives from
// orientation changes, browser chrome, split-screen).
export function useVirtualKeyboard({ enabled, toolbarRef, zoomBadgeRef, zoomHintRef }) {
  // baseline: captured at editor focus, used to gate keyboard detection
  // Returns: { keyboardOpen: boolean }
}
```

**Algorithm:**
1. On editor `focus` event: capture `baselineHeight = visualViewport.height`
2. On `visualViewport.resize` and `window.resize`: compute `delta = baselineHeight - visualViewport.height`
3. If `!enabled` or `delta < 100`: set `bottom = 0`, return. (100px threshold filters browser chrome collapse)
4. `keyboardHeight = Math.min(delta, visualViewport.height * 0.6)` (cap at 60%)
5. `safeArea` = measured probe element height (rAF-deferred, cached until orientation change)
6. `bottom = keyboardHeight + safeArea`
7. **Imperative:** `toolbarRef.current.style.bottom = bottom + 'px'`
8. **Imperative:** `toolbarRef.current.style.paddingBottom = '0'` (suppress CSS env() when keyboard open)
9. **Imperative:** update zoom badge/hint bottom similarly
10. Update `keyboardOpenRef.current` (ref, not state, for imperative path)
11. Set React state `keyboardOpen = true` (throttled — only changes when crossing 100px threshold)

**Orientation change:** Listen to `orientationchange`. On change:
- Reset `baselineHeight = null` (will re-capture at next focus)
- Remove CSS transition for 1 frame, then restore

**Samsung Internet fallback:** Also listen to `window.resize`. If `window.visualViewport` is undefined, compute via `window.innerHeight - document.documentElement.clientHeight`.

**Cleanup:** Remove all event listeners on unmount. Cancel any pending rAF.

### 2. Update `EditorPanel.jsx`

- Pass `toolbarRef`, `zoomBadgeRef`, `zoomHintRef` to `useVirtualKeyboard()`
- Receive `{ keyboardOpen }` state
- `ResizeObserver` on `toolbarRef` → `setEditorPaddingBottom(toolbarH + (keyboardOpen ? keyboardHeight : 0))`
  - Note: `keyboardHeight` read from hook's ref (not re-queried), so no dependency loop
- Scroll into view: `useEffect([keyboardOpen], () => { if (keyboardOpen) { /* existing scroll helper */ } })`

### 3. Update `Toolbar.jsx`

- Accept `toolbarRef` prop (or forward ref) — passed down from EditorPanel
- **No** `keyboardHeight` prop (imperative hook writes directly)
- CSS transition still applies (set on the element itself)

### 4. CSS updates (`responsive.css`)

- Add `transition: bottom var(--duration-medium) var(--ease-out)` to `.toolbar` in responsive context
- Remove `padding-bottom: env(safe-area-inset-bottom)` from `.toolbar` — managed imperatively when keyboard is open; restore via JS when keyboard closes
- Remove `padding-bottom: 52px` from `.editor-panel` — managed via `editorPaddingBottom` React state

### 5. Dynamic editor bottom padding

`ResizeObserver` on toolbar root — fires on ALL height changes (findOpen, inTable shading, AI groups, expand/collapse, wrapping):

```js
// In EditorPanel.jsx
useEffect(() => {
  if (!toolbarRef.current) return
  const ro = new ResizeObserver(entries => {
    const toolbarH = entries[0].contentRect.height
    setEditorPaddingBottom(toolbarH + (keyboardOpenRef.current ? cachedKeyboardHeight.current : 0))
  })
  ro.observe(toolbarRef.current)
  return () => ro.disconnect()
}, [])
```

### 6. Zoom badge/hint (editor.css + EditorPanel.jsx)

The `.zoom-badge` (`bottom: 20px`) and `.zoom-hint` (`bottom: 72px`) must lift with the keyboard. Pass `zoomBadgeRef` and `zoomHintRef` to the hook. The hook applies:
```
zoomBadgeRef.current.style.bottom = (20 + keyboardHeight) + 'px'
zoomHintRef.current.style.bottom  = (72 + keyboardHeight) + 'px'
```
Remove the `env(safe-area-inset-bottom)` from these CSS rules — the hook manages positioning when keyboard is open.

### Known Limitations

- Samsung DEX, Android split-screen, Gboard floating keyboard can produce false-positive `keyboardHeight` values. The focus-gate reduces most false positives; split-screen remains a known edge case. Documented, not fixed.
- iOS Safari soft keyboard behavior on iPad is inconsistent. Not a primary target (single user on Android phone).

## Test Plan

### Unit tests
- `src/hooks/__tests__/useVirtualKeyboard.test.js`
  - Returns 0 when `visualViewport` is undefined
  - Returns correct height when viewport shrinks
  - Cleans up event listeners on unmount

### E2E tests (Playwright — Mobile Chrome viewport)
- `e2e/issue-124-keyboard-toolbar.spec.js`
  - Focus the editor on mobile viewport
  - Verify toolbar is visible (not hidden behind keyboard simulation)
  - Tap Bold button while keyboard is simulated open → text becomes bold
  - Note: Playwright can't open the actual Android virtual keyboard; test with simulated viewport resize to mimic keyboard

## Out of Scope

- iOS-specific scroll-into-view behavior (separate issue if needed)
- Keyboard accessory bar customization (native iOS, not controllable from web)
- `interactive-widget=resizes-content` viewport meta tag — not supported on Android Chrome < 108 and unreliable

## Files Affected

| File | Change |
|------|--------|
| `src/hooks/useVirtualKeyboard.js` | NEW — imperative keyboard height hook; writes directly to toolbarRef, zoomBadgeRef, zoomHintRef |
| `src/hooks/__tests__/useVirtualKeyboard.test.js` | NEW — unit tests (`@vitest-environment jsdom` docblock required) |
| `src/components/EditorPanel.jsx` | Wire useVirtualKeyboard; ResizeObserver for editorPaddingBottom; useEffect([keyboardOpen]) for scroll-into-view |
| `src/components/editor/Toolbar.jsx` | Accept + forward `toolbarRef`; remove keyboardHeight prop (no longer needed) |
| `src/styles/responsive.css` | Add `transition: bottom var(--duration-medium) var(--ease-out)` to `.toolbar`; remove static `padding-bottom: 52px` from `.editor-panel` |
| `src/styles/editor.css` | Note: zoom badge CSS env() suppressed imperatively when keyboard open; no static change needed |
| `e2e/issue-124-keyboard-toolbar.spec.js` | NEW — E2E test (mobile viewport resize to simulate keyboard) |

## CEO Review Findings (Phase 1)

### Scope Additions (auto-accepted)
- **Samsung Internet fallback:** Hook must also listen to `window.resize` and compute height via `window.innerHeight - window.visualViewport.height` as a fallback for browsers with inconsistent `visualViewport` events (Samsung Internet). Same computation, additional event listener.
- **Safe area inset in JS:** When `keyboardHeight > 0`, read the iOS safe area inset via `getComputedStyle` on a probe element (or hard-code 34px for modern iPhones) and add it to `keyboardHeight` to prevent toolbar from kissing the home indicator. When keyboard closes, CSS `padding-bottom: env(safe-area-inset-bottom)` resumes naturally.
- **Cursor scroll-into-view:** In EditorPanel `useEffect([keyboardHeight])`, call `editor?.commands?.scrollIntoView()` when `keyboardHeight > 0` and editor is focused.
- **Position guard:** `keyboardHeight = Math.min(keyboardHeight, window.visualViewport.height * 0.6)`

### Deferred to TODOS.md
- Haptic feedback on mobile toolbar buttons (unrelated, out of blast radius)
- Mobile role definition: decide whether mobile is full-authoring or capture/triage (strategic, worth a future office-hours session)

### CEO Outside Voice Summary
**Codex** (adversarial): Raised strategic question about mobile role (full authoring vs capture-only), flagged E2E test fidelity gap, flagged coupling growth in EditorPanel, flagged start of a mobile keyboard subsystem. 7 findings total.

**Claude subagent** (independent): Agreed fix is correct and necessary. Flagged Samsung Internet fallback (HIGH), safe area inset compositing (HIGH), dismissed `interactive-widget` meta correctly (LOW).

**Consensus:** Both agree the fix is the right approach. Both flag Samsung Internet and safe area as HIGH-severity gaps. Codex additionally raises a strategic reframing question (→ TASTE DECISION, surfaced at final gate).

### NOT in Scope (CEO Phase)
- Full-screen editing mode on mobile
- Contextual selection toolbar (replaces fixed toolbar)
- Slash menu / command palette
- `interactive-widget=resizes-content` meta tag
- Mobile role strategy (deferred to TODOS)
- Offline durability during viewport changes (existing behavior, not regressed)

### What Already Exists
| Sub-problem | Existing code |
|-------------|---------------|
| Touch detection | `src/utils/device.js::isTouchOnlyDevice()` |
| isTouchOnly threading | `EditorPanel.jsx` → `Toolbar.jsx` via props |
| Fixed toolbar positioning | `responsive.css` `.toolbar { position: fixed; bottom: 0 }` |
| Motion tokens | `--duration-medium: 300ms`, `--ease-out` in DESIGN.md |
| Hook pattern | `src/hooks/useContentZoom.js` (analogous: viewport-aware hook) |

## Design Review Findings (Phase 2)

### Issues resolved (auto-decided)
- **Transition timing:** `--duration-medium: 300ms` + `var(--ease-out)`, symmetrical open/close. Tracks rAF per frame (not debounced to keyboard settle).
- **Dynamic padding:** `editorPaddingBottom = keyboardHeight + currentToolbarHeight` via `toolbarRef.getBoundingClientRect().height`. Recomputes on both `keyboardHeight` and `toolbarExpanded` changes.
- **Safe area:** Probe element approach (not magic number). Measured once at mount.
- **Focus/selection:** Existing `onMouseDownCapture preventDefault` in `Toolbar.jsx:205` already preserves editor selection. No change needed.

### Design outside voice summary
**Codex:** Plan serves developer not user. No UX state model, accessibility absent, expanded/collapsed with keyboard unspecified. Strong and correct critique.
**Claude subagent:** Missing state spec (CRITICAL), dynamic padding with expanded toolbar (CRITICAL), safe area fork unresolved (HIGH), hierarchy ordering (HIGH).

Both models agree: UX spec was missing. Fixed above in "UX Interaction Spec" section.

### TASTE DECISION: Auto-collapse toolbar when keyboard opens
Codex and subagent both flag that keeping the full expanded toolbar while keyboard is open reduces content space significantly. Option: auto-collapse to single row on keyboard open (regardless of current `toolbarExpanded` state). Surfaced at gate.

## Eng Review Findings (Phase 3)

### Architecture change: Imperative DOM (auto-accepted)

The original plan used React state (`keyboardHeight`) threaded as a prop through EditorPanel → Toolbar, with `style={{ bottom: keyboardHeight + 'px' }}` applied via React render. Codex (eng review) identified this fires a React render on every `visualViewport` event — up to 60fps through a 40+ prop Toolbar component. Switched to the `useContentZoom.js` imperative pattern: the hook takes `toolbarRef`, `zoomBadgeRef`, `zoomHintRef` and writes `el.style.bottom` directly during animation. React state updates only on threshold crossing (keyboard open/closed).

### Findings resolved (auto-accepted)

- **Imperative DOM for per-frame animation:** Hook writes directly to refs. React state updates only on open/close threshold crossing. Prevents per-frame re-renders through Toolbar's large prop surface.
- **ResizeObserver replaces useEffect dep:** `ResizeObserver` on `toolbarRef` fires on all toolbar height changes — expand/collapse, findOpen, inTable controls, AI groups, row wrapping. `useEffect([toolbarExpanded])` would miss dynamic height changes from features it doesn't know about.
- **Focus gate required:** Capture `baselineHeight = visualViewport.height` at editor focus. Only treat viewport shrink as keyboard if delta > 100px and editor was recently focused. Prevents false positives from orientation changes, browser chrome collapse, split-screen.
- **Orientation change stutter fix:** `orientationchange` fires a cascade of resize events with intermediate heights. Fix: on `orientationchange`, set `baselineHeight = null` (re-captures at next focus), remove CSS `transition` for 1 frame via `requestAnimationFrame`, then restore. Prevents stutter.
- **Safe area double-application fixed:** When inline `style.bottom` overrides CSS `bottom`, the CSS `padding-bottom: env(safe-area-inset-bottom)` is still active, causing double-application. Fix: when keyboard opens, imperatively set `toolbarRef.current.style.paddingBottom = '0'`; compose safe area entirely in the JS `bottom` value. When keyboard closes, set `paddingBottom = ''` to restore CSS env().
- **Zoom badge/hint must lift:** `.zoom-badge` (`bottom: calc(20px + env(safe-area-inset-bottom))`) and `.zoom-hint` (`bottom: calc(72px + env(safe-area-inset-bottom))`) are fixed-bottom and will collide with a lifted toolbar. Hook lifts them imperatively: `zoomBadgeRef.current.style.bottom = (20 + safeArea + keyboardHeight) + 'px'`. CSS env() in their base rules is suppressed same as toolbar when keyboard is open.
- **Samsung Internet fallback added:** Also listen to `window.resize`. Compute fallback: `window.innerHeight - document.documentElement.clientHeight`. Use whichever event fires with the larger delta.
- **Cap at 60% visual height:** `keyboardHeight = Math.min(delta, visualViewport.height * 0.6)`. Prevents absurd values from split-screen or floating keyboard.
- **Scroll-into-view stays in EditorPanel:** `useEffect([keyboardOpen])` in EditorPanel calls `editor?.commands?.scrollIntoView()`. Keeps hook decoupled from editor internals.

### Failure modes registry

| Failure | Trigger | Mitigation |
|---------|---------|------------|
| Keyboard height = 0 even when open | visualViewport undefined (old browser) | Fallback: window.resize + clientHeight delta |
| False positive keyboard detection | Orientation change or browser chrome collapse | Focus gate + 100px threshold |
| Animation stutter on orientation change | Cascade of resize events with intermediate heights | Disable CSS transition for 1 frame on orientationchange |
| Toolbar clips home indicator (iOS) | Inline bottom overrides CSS env() | JS probe element for safeArea; paddingBottom = '0' when keyboard open |
| Zoom badge overlaps lifted toolbar | badge is fixed bottom; toolbar lifts | zoomBadgeRef lifted imperatively |
| Samsung Internet misses visualViewport events | Browser bug | window.resize fallback + clientHeight |
| Editor content hidden behind toolbar | keyboard changes editor visible area | ResizeObserver → editorPaddingBottom = toolbarH + keyboardHeight |
| Split-screen false positive (known edge case) | Split-screen changes visual height without keyboard | Focus gate reduces; documented limitation |
| Memory leak | Component unmounts mid-gesture | cleanup removes all listeners + cancels rAF |

### Eng outside voice summary

**Codex** (adversarial): Identified React re-render concern with state-based approach (HIGH). Flagged that `useEffect([toolbarExpanded])` misses dynamic toolbar height changes (HIGH). Raised orientation change cascade stutter (MEDIUM). Flagged safe area double-application (HIGH). Overall: architecture change required, not just additions.

**Claude subagent** (independent): Agreed imperative DOM is correct. Flagged focus-gate requirement to prevent false positives (HIGH). Flagged zoom badge collision (HIGH). Flagged `paddingBottom = '0'` override needed when keyboard open (MEDIUM). Overall: agrees with direction, named specific DOM hazards.

**Consensus:** Both voices agree imperative DOM is the right architecture. Both flag safe area compositing and zoom badge as hazards. Codex additionally called out ResizeObserver over useEffect dep list.

### TASTE DECISIONS — Final Gate Outcomes
- **#9 (CEO) Mobile role:** DECIDED — Ship #124 as full authoring infrastructure. Strategy question deferred to TODOS.md for future office-hours session.
- **#15 (Design) Auto-collapse on keyboard open:** DECIDED — Leave toolbar state alone. Respects explicit user choice; can add auto-collapse later if it becomes a pain point.

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|-----------|-----------|----------|---------|
| 1 | CEO | Approach A (visualViewport hook) over B (meta tag) or C (redesign) | Mechanical | P5 Explicit | A is only approach with full Android+iOS support | B: Chrome 108+/no iOS. C: overengineered |
| 2 | CEO | Mode = SELECTIVE EXPANSION | Mechanical | P2 Boil Lakes | Feature enhancement on active mobile system | HOLD SCOPE too narrow for this iteration |
| 3 | CEO | Add cursor scroll-into-view on keyboard open | Mechanical | P2 Boil Lakes | In blast radius, XS effort, prevents cursor hidden by toolbar | — |
| 4 | CEO | Add toolbar position guard (max bottom = visualViewport.height * 0.6) | Mechanical | P1 Completeness | Edge case: very tall keyboards could push toolbar off-screen | — |
| 5 | CEO | Deferred haptic feedback to TODOS.md | Mechanical | P4 DRY | Out of blast radius, unrelated mobile polish | — |
| 6 | CEO | Add Samsung Internet resize fallback to hook | Mechanical | P1 Completeness | Subagent: HIGH — visualViewport inconsistent on Samsung Internet | Skip: risk of silent failure on user's actual device |
| 7 | CEO | Compute safe area inset in JS when keyboardHeight > 0 | Mechanical | P1 Completeness | Subagent: HIGH — inline bottom style overrides CSS env(), iPhone home indicator clips | Skip: visible bug on iOS |
| 8 | CEO | interactive-widget meta tag dismissed correctly | Mechanical | P3 Pragmatic | LOW finding from subagent; iOS Safari doesn't support it | Include: would break iOS |
| 9 | CEO-TASTE | Mobile role: full authoring vs capture/triage | TASTE — DECIDED | — | Ship #124 now; strategy deferred to TODOS.md | Pause #124: defers concrete fix for abstract question |
| 10 | CEO | Scroll-into-view triggered from EditorPanel useEffect, not inside hook | Mechanical | P5 Explicit | Prevents coupling of hook to editor internals | In hook: wrong abstraction layer |
| 11 | Design | Transition: 300ms ease-out symmetrical, rAF tracking (not debounced) | Mechanical | P1 Completeness | Matches DESIGN.md, smooth tracking is the right UX | Debounced: feels laggy |
| 12 | Design | Editor padding = keyboardHeight + toolbarRef.getBoundingClientRect().height | Mechanical | P1 Completeness | Dynamic toolbar height (collapsed vs expanded) requires measured value | Fixed 52px: breaks on expand |
| 13 | Design | Safe area: probe element, not hardcoded 34px | Mechanical | P3 Pragmatic | Probe is testable; 34px breaks on iPad/future devices | Hardcoded: magic number |
| 14 | Design | Focus/selection preservation: existing onMouseDownCapture covers this | Mechanical | P5 Explicit | Already implemented in Toolbar.jsx:205 | New code: unnecessary |
| 15 | Design-TASTE | Auto-collapse toolbar when keyboard opens | TASTE — DECIDED | — | REJECTED: leave toolbar state alone; respects explicit user choice | Auto-collapse: feels presumptuous on single-user app |
| 16 | Eng | Architecture: imperative DOM (not React state) for per-frame animation | Mechanical | P3 Pragmatic | Codex: HIGH — per-frame React re-renders through 40+ prop Toolbar unacceptable | State-based: correct but slow |
| 17 | Eng | ResizeObserver (not useEffect dep) for toolbar height tracking | Mechanical | P1 Completeness | Catches all height changes: expand, findOpen, inTable, AI groups, wrapping | useEffect([toolbarExpanded]): misses dynamic changes |
| 18 | Eng | Focus gate: capture baseline at editor focus, 100px threshold | Mechanical | P1 Completeness | Prevents false positives from orientation changes, browser chrome, split-screen | No gate: spurious keyboard detections |
| 19 | Eng | Orientation change: null baseline + disable transition for 1 rAF | Mechanical | P1 Completeness | Cascade of resize events with intermediate heights causes stutter | Ignore: visible stutter on rotation |
| 20 | Eng | paddingBottom = '0' when keyboard open; restore on close | Mechanical | P1 Completeness | Prevents CSS env() double-application when inline style.bottom overrides CSS bottom | Leave CSS: safe area applied twice |
| 21 | Eng | Zoom badge/hint lifted imperatively via zoomBadgeRef/zoomHintRef | Mechanical | P2 Boil Lakes | Fixed-bottom elements collide with lifted toolbar; in blast radius | Leave in place: visual collision |
| 22 | Eng | Samsung Internet: window.resize fallback + clientHeight delta | Mechanical | P1 Completeness | Browser bug: visualViewport events inconsistent on Samsung Internet | Single event: silent failure on user's device |
| 23 | Eng | vitest.config.js: @vitest-environment jsdom docblock for hook tests | Mechanical | P5 Explicit | No global jsdom; window.visualViewport needs browser env | No docblock: tests error on window access |
| 24 | Eng | Cleanup: remove all listeners + cancel rAF on unmount | Mechanical | P1 Completeness | Prevent memory leak if component unmounts mid-gesture | Skip: leak on unmount |
| 25 | Eng | Hook signature: { enabled, toolbarRef, zoomBadgeRef, zoomHintRef } → { keyboardOpen } | Mechanical | P5 Explicit | Minimal surface; returns only boolean state needed by EditorPanel | Expose keyboardHeight: leaks imperative detail |
