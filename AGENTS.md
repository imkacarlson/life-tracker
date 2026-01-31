# AGENTS.md

## Project Overview

Building a personal task/notes tracker web app to replace OneNote. Single-user app accessed via browser on laptop and Android phone.

## Tech Stack

- **Frontend:** React with Vite
- **Backend/Database:** Supabase (Postgres + Auth + Realtime)
- **Hosting:** Vercel (later)
- **AI:** Claude API (Phase 5)

## Core Workflow to Replicate

The user organizes tasks in monthly "trackers":
- Each month has a tracker (e.g., "January 2026 Tracker")
- Tracker is a single-column structure where each row is a **category** (Running, Finance, Wedding, etc.)
- Each category contains **bullet point items** (tasks/notes)
- Daily, user creates a **daily task list** by linking to items from the tracker
- Completing an item crosses it off in both places

## Development Phases

### Phase 1: Foundation (START HERE)
1. Scaffold React app with Vite: `npm create vite@latest . -- --template react`
2. Install Supabase client: `npm install @supabase/supabase-js`
3. Create `src/lib/supabase.js` with client config (will need project URL and anon key)
4. Implement Supabase Auth with email/password login
5. Build simple login page, protect main route, add logout button
6. Create a test table and verify read/write works when authenticated

**Phase 1 complete when:** User can log in, see data from database, add items, log out.

### Phase 2: Core Data Model & UI
- Schema: months → categories → items (with nesting support)
- Build tracker view: display categories and bullet points
- CRUD operations for items
- Realtime sync (test in two browser tabs)

### Phase 3: Daily Task List & Linking
- Daily view page
- Link items from tracker to daily list
- Cross-off syncs between views

### Phase 4: Mobile Polish
- Responsive CSS for phone browser
- Touch/scroll UX fixes

### Phase 5: AI Integration
- Claude API connection
- "Generate today's tasks" feature
- Chat interface for querying tracker

## Code Style Preferences

- Keep code simple and readable - user is not experienced in JavaScript/React
- Prefer clear patterns over clever abstractions
- Comment non-obvious logic
- This is a personal project - working beats perfect

## Commands

- `npm run dev` - Start dev server
- `npm run build` - Production build