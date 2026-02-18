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

### Phase 4: Mobile Polish & Touch
- Responsive CSS for phone browser
- Touch-friendly toolbar
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

## Commands

- `npm run dev` - Start dev server
- `npm run build` - Production build
