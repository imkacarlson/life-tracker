# Design System — Life Tracker

## Product Context
- **What this is:** A personal task/notes tracker web app replacing OneNote — rich text editor with notebooks, sections, and pages
- **Who it's for:** Single user, accessed on laptop and Android phone
- **Space/industry:** Personal productivity / note-taking (Notion, Obsidian, Craft)
- **Project type:** Web app (React + Vite + Supabase + Tiptap)

## Aesthetic Direction
- **Direction:** Warm Industrial — function-first but not sterile. A well-lit workspace with natural materials.
- **Decoration level:** Minimal — typography, spacing, and one accent color do all the work. No gradients, no decorative shadows, no visual noise.
- **Mood:** The app should feel like a tool you reach for, not software you tolerate. Warm, personal, focused.
- **Key differentiators:** Warm stone neutrals instead of cool grays; teal accent instead of the standard blue.

## Typography
- **Display/Headings:** Satoshi — geometric sans with personality. Clean but not generic.
- **Body/UI:** Instrument Sans — optimized for reading at small sizes, slightly warm character.
- **Data/Tables:** Instrument Sans with `font-variant-numeric: tabular-nums` for aligned numbers.
- **Code/Meta:** JetBrains Mono — for save status, word counts, timestamps, code blocks.
- **Loading:** Satoshi via Fontshare CDN (`https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700&display=swap`), Instrument Sans and JetBrains Mono via Google Fonts.
- **Scale:**
  - 2xl: 32px / 2rem — Page titles (Satoshi 700)
  - xl: 24px / 1.5rem — Section headings (Satoshi 700)
  - lg: 18px / 1.125rem — Category headers (Satoshi 600)
  - base: 15px / 0.9375rem — Body text, editor content (Instrument Sans 400)
  - sm: 13px / 0.8125rem — Sidebar labels, metadata, timestamps (Instrument Sans 500)
  - xs: 11px / 0.6875rem — Section headers, badges (JetBrains Mono 500, uppercase, 0.1em tracking)

## Color
- **Approach:** Restrained — warm neutrals + one accent. Color is rare and meaningful.
- **Primary accent:** `#0D9488` (teal-600) — interactive elements, active states, links
- **Accent light:** `#14B8A6` — hover states
- **Accent dark:** `#0F766E` — pressed states, text on accent backgrounds
- **Accent subtle:** `#CCFBF1` — soft backgrounds (active sidebar, badges)
- **Accent bg:** `#F0FDFA` — very light accent wash
- **Neutrals (warm stone grays):**
  - Stone 900: `#1C1917` — primary text
  - Stone 600: `#57534E` — secondary text
  - Stone 500: `#78716C` — utility contrast, table borders
  - Stone 400: `#A8A29E` — muted text, placeholders
  - Stone 200: `#E7E5E4` — borders
  - Stone 300: `#D6D3D1` — strong borders (dividers, toolbar)
  - Stone 100: `#F5F5F4` — raised surfaces, toolbar background
  - Stone 50: `#FAFAF9` — page background
  - White: `#FFFFFF` — card/surface background
- **Table borders:** Use Stone 500 `#78716C` for table gridlines and outer table edges so tables stay clearly legible against the warm neutral canvas without darkening other dividers.
- **Semantic:**
  - Success: `#16A34A` — saved, completed
  - Warning: `#D97706` — unsaved changes
  - Error: `#DC2626` — save failures
  - Info: `#0284C7` — AI processing, informational
- **Dark mode strategy:** Invert surface hierarchy (Stone 900 as bg, Stone 800 `#292524` as surface, Stone 700 `#44403C` as raised). Reduce accent saturation ~10%. Semantic colors get darker container backgrounds.

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable
- **Scale:**
  - 2xs: 2px
  - xs: 4px
  - sm: 8px
  - md: 16px
  - lg: 24px
  - xl: 32px
  - 2xl: 48px
  - 3xl: 64px

## Layout
- **Approach:** Grid-disciplined — sidebar + editor canvas, already established
- **Grid:** Single breakpoint shift: desktop = editor + resizable sidebar; mobile (≤900px) = stacked
- **Max content width:** No hard max (editor fills available space)
- **Border radius:**
  - sm: 4px — toolbar buttons, small controls
  - md: 8px — inputs, dropdowns, cards
  - lg: 12px — modals, large cards, section tabs
  - full: 9999px — badges, pills, theme toggle

## Motion
- **Approach:** Minimal-functional — only transitions that aid comprehension
- **Easing:** `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out for enters/interactions)
- **Duration:**
  - Micro: 80ms — button press feedback
  - Short: 150ms — hover states, toolbar button toggles
  - Medium: 300ms — sidebar expand/collapse, theme toggle, mobile toolbar expand
- **No entrance animations.** No scroll-driven effects. No decorative motion.

## Logo
- **Type:** Simple geometric icon — teal rounded square with upward trend line + arrow
- **Meaning:** Forward progress, tracking, growth
- **Usage:** Header (28px), favicon (24px SVG), mobile back-nav context
- **Implementation:** Inline SVG, no external file needed. Teal background (`#0D9488`) with white stroke paths.
- **SVG markup:**
  ```svg
  <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="48" height="48" rx="10" fill="#0D9488"/>
    <path d="M12 28L20 20L26 26L36 16" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M30 16H36V22" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  ```

## Mobile Toolbar (Issue #35)
- **Pattern:** Collapsible toolbar with sticky single row
- **Collapsed state (default):** 6 core actions — Bold, Italic, Heading, Bullet List, Link, Undo — plus expand chevron (▾)
- **Expanded state:** Full toolbar wraps to multiple rows, chevron flips (▴)
- **Transition:** Medium duration (300ms), height animation with ease-out
- **Rationale:** Reclaims ~40px of vertical space for content on mobile. Core 6 actions cover 90%+ of mobile editing. Full toolbar is one tap away.

## CSS Custom Properties
```css
:root {
  /* Accent */
  --accent: #0D9488;
  --accent-light: #14B8A6;
  --accent-dark: #0F766E;
  --accent-subtle: #CCFBF1;
  --accent-bg: #F0FDFA;

  /* Neutrals */
  --bg: #FAFAF9;
  --surface: #FFFFFF;
  --surface-raised: #F5F5F4;
  --border: #E7E5E4;
  --border-strong: #D6D3D1;
  --table-border: #78716C;
  --text: #1C1917;
  --text-secondary: #57534E;
  --text-muted: #A8A29E;

  /* Semantic */
  --success: #16A34A;
  --warning: #D97706;
  --error: #DC2626;
  --info: #0284C7;

  /* Fonts */
  --font-display: 'Satoshi', sans-serif;
  --font-body: 'Instrument Sans', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  /* Spacing */
  --space-2xs: 2px;
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-2xl: 48px;
  --space-3xl: 64px;

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 9999px;

  /* Motion */
  --duration-micro: 80ms;
  --duration-short: 150ms;
  --duration-medium: 300ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

## Preview Page
The design system preview (with rendered fonts, colors, mockups, and mobile toolbar) is at:
`/tmp/design-consultation-preview-1774395879.html`

To regenerate, copy the preview HTML from the git history or re-run `/design-consultation`.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-24 | Initial design system created | Created by /design-consultation based on product context and Supabase data analysis |
| 2026-03-24 | Warm stone neutrals over cool slates | Personal tool should feel warm, not corporate. Easier on eyes for long editing. |
| 2026-03-24 | Teal accent (#0D9488) over blue | Every productivity app uses blue. Teal is distinctive without being loud. |
| 2026-03-24 | Satoshi + Instrument Sans + JetBrains Mono | Satoshi: geometric personality for headings. Instrument Sans: warm, readable body. JetBrains Mono: best-in-class for data. |
| 2026-03-24 | Collapsible mobile toolbar | Issue #35 — single row with 6 core actions + expand. Reclaims ~40px vertical space. |
| 2026-03-24 | Simple trend-line logo icon | Issue #34 — replaces Vite logo. Teal rounded square with upward trend arrow. Works at favicon size. |
