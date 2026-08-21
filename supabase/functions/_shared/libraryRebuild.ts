// The Library rebuild: topic catalogs, section front pages, Lately, Activity.
//
// HOUSE RULE: zero jsr:/npm:/https:// imports, zero top-level `Deno.*`. The
// Supabase client and every env-derived value arrive as parameters, the way
// deepLink.ts takes `appUrl`. That is what lets Vitest import this directly —
// and this logic previously lived inside a monolithic Deno.serve, where it had
// no tests at all.
//
// ── ZERO MODEL CALLS ────────────────────────────────────────────────────────
// Nothing here talks to Claude. The summary was written once by the no-tools
// call at capture time and stored on the page; topic membership was decided in
// that same call and stored as rows. This function only RENDERS stored data,
// which is why it is cheap enough to run after every capture rather than once a
// week.
//
// ── WHAT IS AND ISN'T AT RISK ───────────────────────────────────────────────
// Topic pages, section front pages, Lately, and Activity are 100% model-owned
// and regenerated wholesale. The user's own writing lives on CAPTURE pages —
// under "My notes" — and this function never writes a capture page at all. The
// separation is structural rather than a rule someone has to remember.
//
// ── SCOPING IS MANDATORY ────────────────────────────────────────────────────
// Only topics whose section received a capture since the topic's
// library_rebuilt_at get touched. Everything else is skipped AND THE SKIP IS
// LOGGED — an unscoped "update the wiki" is a documented failure mode of this
// pattern, and the skip lines are what make the scoping visible in Activity.
// `sectionIds` narrows it further still: a rebuild triggered by one capture only
// considers that capture's section. Lately and Activity are Library-wide and
// always rebuild.
//
// ── REVERSIBILITY ───────────────────────────────────────────────────────────
// Every write records the page's previous document in library_activity.prev_content.
// That IS the revert payload, and revert is a plain restore. Silent
// self-rewriting only earns trust if it is inspectable.

import {
  extractNotes,
  renderActivity,
  renderLately,
  renderSectionIndex,
  renderTopicCatalog,
} from './libraryCatalog.ts'
import type { CatalogEntry } from './libraryCatalog.ts'

type SupabaseLike = { from: (table: string) => any }

/** How many Activity rows the Activity page shows. Older rows stay in the table
 *  (they carry the revert payload) and age out on the purge job. */
const ACTIVITY_PAGE_ROWS = 60

/** How far back Lately looks.
 *
 *  The CADENCE is weekly (the cron), the WINDOW is not. At a week, anything
 *  saved eight days ago had already vanished from the only page that shows the
 *  Library as a whole — which reads as things going missing, not as a tidy page.
 *  Thirty days is long enough that a save is still there next time you look. */
const LATELY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

/**
 * The section that holds the model's own Library-wide pages.
 *
 * Creating it bends "sections are the user's" — but only for the model's own
 * scaffolding, never for a topical category. Without somewhere to put Lately and
 * Activity they'd squat in whichever section happened to be first, which is
 * worse. It is logged in Activity.
 *
 * This is only the title used when CREATING it. The section is found by where
 * Lately and Activity actually live (see ensureHomeSection), so renaming it
 * sticks. Deleting it does not — the next capture needs somewhere to put those
 * two pages, so it comes back.
 */
export const HOME_SECTION_TITLE = 'Home'

/**
 * Every section's front page is called this.
 *
 * Deliberately NOT the same word as the home section. An earlier pass named both
 * "Overview" and the sidebar became unreadable: two adjacent rows with one
 * label, one a page and one a section, and nothing saying which was which.
 */
export const SECTION_INDEX_TITLE = 'Overview'

/** Sky, the first entry in the app's COLOR_PALETTE — distinct from the pink the
 *  user's own first Library section happens to carry. */
const HOME_SECTION_COLOR = '#e0f2fe'

const PAGE_COLS =
  'id, title, content, section_id, user_id, library_role, library_rebuilt_at, created_at'

export type PageRow = {
  id: string
  title: string
  content: Record<string, unknown> | null
  section_id: string | null
  user_id: string
  library_role: string | null
  library_rebuilt_at: string | null
  created_at: string
}

export type SectionRow = {
  id: string
  title: string
  notebook_id: string
  sort_order: number | null
}

/** One line destined for library_activity. `kind` must be one of the values the
 *  table's CHECK constraint allows. */
export type ActivityEntry = {
  kind: string
  target_page_id: string | null
  summary: string
  prev_content?: unknown
}

export type RebuildOptions = {
  timeZone: string
  /** Report what would happen and write nothing. Mirrors REMINDER_DRY_RUN. */
  dryRun?: boolean
  /** Scope: only these sections' topics and front pages are considered. Lately
   *  and Activity are Library-wide and rebuild regardless. */
  sectionIds?: string[]
  now?: Date
  activityPageRows?: number
}

export type RebuildSummary = {
  ok: boolean
  dryRun: boolean
  topicsRebuilt: number
  topicsSkipped: number
  sectionsRebuilt: number
  latelyRebuilt: number
  homeSectionCreated: boolean
  note?: string
  error?: string
}

export type RebuildResult = { summary: RebuildSummary; log: ActivityEntry[] }

type Ctx = {
  supabase: SupabaseLike
  now: Date
  dryRun: boolean
  log: ActivityEntry[]
  /** Pages this run created. Kept beside the loaded set rather than spliced into
   *  it, so an Activity line about a page born five lines ago still renders with
   *  its title instead of a bare id. */
  created: PageRow[]
}

/**
 * Write a model-owned page, recording what it replaced.
 *
 * ONLY ever called with a model-owned role. There is no code path here that
 * writes a capture page, which is what makes revert unconditionally safe.
 */
async function writeOwnedPage(
  ctx: Ctx,
  page: PageRow,
  content: unknown,
  activity: ActivityEntry,
): Promise<void> {
  const OWNED = new Set(['topic', 'section_index', 'lately', 'activity'])
  if (!OWNED.has(page.library_role ?? '')) {
    // Defensive: a bug that pointed this at a capture page would silently eat
    // the user's notes. Refuse loudly instead.
    console.error(`refusing to rewrite non-owned page ${page.id} (role=${page.library_role})`)
    return
  }

  ctx.log.push({ ...activity, prev_content: page.content })
  if (ctx.dryRun) return

  const { error } = await ctx.supabase
    .from('pages')
    .update({
      content,
      updated_at: ctx.now.toISOString(),
      library_rebuilt_at: ctx.now.toISOString(),
    })
    .eq('id', page.id)
  if (error) console.error(`write ${page.id} failed:`, error.message)
}

/**
 * Find the home section, creating it if it isn't there yet.
 *
 * IDENTIFIED BY WHAT IT CONTAINS, NOT BY ITS NAME. Wherever Lately and Activity
 * already live IS the home section, whatever the user has since renamed it to.
 * Matching on the title instead would mean a rename silently spawned a second
 * one on the next capture — which is exactly the trap a self-writing feature
 * has to avoid, since the user would have no way to tell why it happened.
 *
 * Existing sections carry `sort_order = null` and the app orders them
 * nullsFirst, so any integer drops this to the bottom of the sidebar. It stays
 * there: reordering the user's own sections is not ours to do.
 *
 * Returns a null id in dry-run mode when the section doesn't exist, so the rest
 * of the run can still report what it *would* create without writing anything.
 */
async function ensureHomeSection(
  ctx: Ctx,
  params: { sections: SectionRow[]; pages: PageRow[]; notebookId: string; userId: string },
): Promise<{ id: string | null; created: boolean }> {
  const { sections, pages, notebookId, userId } = params

  // 1. Wherever the Library-wide pages already sit.
  const homePage = pages.find(
    (page) => page.library_role === 'lately' || page.library_role === 'activity',
  )
  const byContents = homePage?.section_id
    ? sections.find((section) => section.id === homePage.section_id)
    : undefined
  if (byContents) return { id: byContents.id, created: false }

  // 2. A section already carrying the name, from a run that created it but got
  //    no further.
  const byTitle = sections.find(
    (section) => section.title.trim().toLowerCase() === HOME_SECTION_TITLE.toLowerCase(),
  )
  if (byTitle) return { id: byTitle.id, created: false }

  if (ctx.dryRun) {
    ctx.log.push({
      kind: 'page_created',
      target_page_id: null,
      summary: `would create the "${HOME_SECTION_TITLE}" section`,
    })
    return { id: null, created: true }
  }

  const highest = sections.reduce(
    (max, section) => (Number.isFinite(section.sort_order) ? Math.max(max, Number(section.sort_order)) : max),
    -1,
  )

  const { data: section, error } = await ctx.supabase
    .from('sections')
    .insert({
      user_id: userId,
      notebook_id: notebookId,
      title: HOME_SECTION_TITLE,
      color: HOME_SECTION_COLOR,
      sort_order: highest + 1,
    })
    .select('id, title, notebook_id, sort_order')
    .single()
  if (error || !section) {
    console.error('create Home section failed:', error?.message)
    return { id: null, created: false }
  }

  ctx.log.push({
    kind: 'page_created',
    target_page_id: null,
    summary: `created the "${HOME_SECTION_TITLE}" section`,
  })
  return { id: section.id as string, created: true }
}

/**
 * Find a model-owned page, creating it if it isn't there yet.
 *
 * This does NOT violate "sections are the user's" or "topics exist only because
 * the user made one". Those two constraints protect the things the user
 * organizes by. A section front page, Lately, and Activity are scaffolding for
 * the model's own output — the user would never sit down and author them, and
 * without them the rebuild has nowhere to put its results.
 *
 * Returns null in dry-run mode when the page doesn't exist, so a dry run never
 * writes anything at all.
 */
async function ensureOwnedPage(
  ctx: Ctx,
  params: {
    pages: PageRow[]
    userId: string
    sectionId: string | null
    role: 'section_index' | 'lately' | 'activity'
    title: string
    sortOrder?: number
  },
): Promise<PageRow | null> {
  const { pages, userId, sectionId, role, title, sortOrder = -1 } = params

  // A section front page is per-section; Lately and Activity are Library-wide,
  // so the first one found anywhere is the one.
  const existing = [...pages, ...ctx.created].find(
    (page) =>
      page.library_role === role && (role === 'section_index' ? page.section_id === sectionId : true),
  )
  if (existing) return existing

  if (ctx.dryRun) {
    ctx.log.push({
      kind: 'page_created',
      target_page_id: null,
      summary: `would create the "${title}" page`,
    })
    return null
  }
  if (!sectionId) return null

  // Negative sort orders keep the model's own pages above the user's captures.
  const { data: page, error } = await ctx.supabase
    .from('pages')
    .insert({
      user_id: userId,
      section_id: sectionId,
      title,
      content: { type: 'doc', content: [] },
      sort_order: sortOrder,
      library_role: role,
    })
    .select(PAGE_COLS)
    .single()
  if (error || !page) {
    console.error(`create ${role} page failed:`, error?.message)
    return null
  }
  ctx.log.push({
    kind: 'page_created',
    target_page_id: page.id as string,
    summary: `created the "${title}" page`,
  })
  ctx.created.push(page as PageRow)
  return page as PageRow
}

/** What library_sources knows about a capture: where it came from, and what
 *  kind of thing it is. */
type SourceInfo = { site: string | null; kind: string | null }

/** Turn capture pages into catalog entries, quoting the user's own notes. */
function toEntries(pages: PageRow[], sources: Map<string, SourceInfo>): CatalogEntry[] {
  return pages.map((page) => ({
    pageId: page.id,
    title: page.title,
    savedAt: page.created_at,
    site: sources.get(page.id)?.site ?? null,
    kind: sources.get(page.id)?.kind ?? null,
    notes: extractNotes(page.content as never),
  }))
}

/**
 * Rebuild the model-owned Library pages.
 *
 * Never throws: a rebuild is a background nicety, and the thing that triggered
 * it (a cron tick, or a capture the user already saw confirmed) must not fail
 * because rendering did. Failures come back as `summary.ok === false`.
 */
export async function runLibraryRebuild(
  supabase: SupabaseLike,
  options: RebuildOptions,
): Promise<RebuildResult> {
  const {
    timeZone,
    dryRun = false,
    sectionIds: scope,
    now = new Date(),
    activityPageRows = ACTIVITY_PAGE_ROWS,
  } = options

  const log: ActivityEntry[] = []
  const ctx: Ctx = { supabase, now, dryRun, log, created: [] }
  const summary: RebuildSummary = {
    ok: true,
    dryRun,
    topicsRebuilt: 0,
    topicsSkipped: 0,
    sectionsRebuilt: 0,
    latelyRebuilt: 0,
    homeSectionCreated: false,
  }
  const fail = (error: string): RebuildResult => ({ summary: { ...summary, ok: false, error }, log })
  const stop = (note: string): RebuildResult => ({ summary: { ...summary, note }, log })

  try {
    // --- 1. Which notebooks are Libraries? ---
    const { data: notebooks, error: notebookError } = await supabase
      .from('notebooks')
      .select('id, user_id')
      .eq('type', 'library')
    if (notebookError) {
      console.error('load notebooks failed:', notebookError.message)
      return fail('Failed to load notebooks')
    }
    const notebookIds = (notebooks ?? []).map((n: any) => n.id as string)
    if (!notebookIds.length) return stop('no library notebooks')

    const { data: sectionRows, error: sectionError } = await supabase
      .from('sections')
      .select('id, title, notebook_id, sort_order')
      .in('notebook_id', notebookIds)
      .order('sort_order', { ascending: true, nullsFirst: true })
    if (sectionError) {
      console.error('load sections failed:', sectionError.message)
      return fail('Failed to load sections')
    }
    const sections = (sectionRows ?? []) as SectionRow[]
    if (!sections.length) return stop('no library sections')
    const allSectionIds = sections.map((section) => section.id)

    // --- 2. Every page in the Library, once. ---
    // Loaded unscoped even when `scope` narrows the rebuild: Lately covers the
    // whole Library, so it needs every section's recent captures.
    const { data: pageRows, error: pageError } = await supabase
      .from('pages')
      .select(PAGE_COLS)
      .in('section_id', allSectionIds)
    if (pageError) {
      console.error('load pages failed:', pageError.message)
      return fail('Failed to load pages')
    }
    const pages = (pageRows ?? []) as PageRow[]
    const userId = pages[0]?.user_id ?? (notebooks?.[0]?.user_id as string | undefined)
    if (!userId) return stop('empty library')

    const captures = pages.filter((page) => page.library_role === 'capture')
    const topics = pages.filter((page) => page.library_role === 'topic')

    // Site labels and kinds, for the "— Podcast · example.com" half of a catalog
    // line. source_type is constrained to article/podcast/note/thread, so it can
    // be rendered as a word without any mapping table beyond KIND_LABELS.
    const sources = new Map<string, SourceInfo>()
    if (captures.length) {
      const { data: sourceRows } = await supabase
        .from('library_sources')
        .select('page_id, source_meta, source_type')
        .in(
          'page_id',
          captures.map((page) => page.id),
        )
      for (const row of sourceRows ?? []) {
        const meta = (row.source_meta ?? {}) as Record<string, string>
        sources.set(row.page_id as string, {
          site: meta.site ?? meta.showName ?? meta.domain ?? null,
          kind: (row.source_type as string) ?? null,
        })
      }
    }
    const entryById = new Map(toEntries(captures, sources).map((entry) => [entry.pageId, entry]))

    // --- 3. The home section, which holds Lately and Activity. ---
    const home = await ensureHomeSection(ctx, {
      sections,
      pages,
      notebookId: sections[0].notebook_id,
      userId,
    })
    summary.homeSectionCreated = home.created

    // --- 4. Topic catalogs, SCOPED. ---
    const { data: memberRows } = await supabase
      .from('library_topic_members')
      .select('topic_page_id, capture_page_id, reason')
      .eq('user_id', userId)
    // The reason rides along with the id: it was written once, when membership
    // was decided, and a catalog line reads far better with it than without.
    const membersByTopic = new Map<string, Array<{ id: string; reason: string | null }>>()
    for (const row of memberRows ?? []) {
      const list = membersByTopic.get(row.topic_page_id as string) ?? []
      list.push({ id: row.capture_page_id as string, reason: (row.reason as string) ?? null })
      membersByTopic.set(row.topic_page_id as string, list)
    }

    // Newest capture per section — the scoping signal.
    const newestCaptureBySection = new Map<string, number>()
    for (const capture of captures) {
      if (!capture.section_id) continue
      const at = Date.parse(capture.created_at ?? '') || 0
      const current = newestCaptureBySection.get(capture.section_id) ?? 0
      if (at > current) newestCaptureBySection.set(capture.section_id, at)
    }

    const sectionTitleById = new Map(sections.map((section) => [section.id, section.title]))
    const inScope = (sectionId: string | null): boolean =>
      !scope || (sectionId != null && scope.includes(sectionId))

    for (const topic of topics) {
      if (!inScope(topic.section_id)) continue

      const lastRebuilt = Date.parse(topic.library_rebuilt_at ?? '') || 0
      const newestCapture = topic.section_id ? (newestCaptureBySection.get(topic.section_id) ?? 0) : 0
      if (lastRebuilt && newestCapture <= lastRebuilt) {
        // Skipped — and LOGGED. This line is the whole point of scoping being
        // visible rather than silent.
        summary.topicsSkipped += 1
        log.push({
          kind: 'skipped',
          target_page_id: topic.id,
          summary:
            `skipped "${topic.title}" — no new captures in ` +
            `${sectionTitleById.get(topic.section_id ?? '') ?? 'its section'} since the last rebuild`,
        })
        continue
      }

      const members = membersByTopic.get(topic.id) ?? []
      const entries = members
        .map((member) => {
          const entry = entryById.get(member.id)
          // Reason is per (topic, capture), so it is attached HERE rather than
          // on the shared entry — the same capture in two topics is filed into
          // each for a different reason.
          return entry && member.reason ? { ...entry, reason: member.reason } : entry
        })
        .filter((entry): entry is CatalogEntry => Boolean(entry))

      await writeOwnedPage(
        ctx,
        topic,
        // Renders from STORED membership. It does not re-decide what belongs —
        // that was settled at capture time and at topic creation.
        renderTopicCatalog({ entries, timeZone }),
        {
          kind: 'topic_rebuilt',
          target_page_id: topic.id,
          summary: `rebuilt from ${entries.length} saved item(s)`,
        },
      )
      summary.topicsRebuilt += 1
    }

    // --- 5. Section front pages. ---
    for (const section of sections) {
      // The home section holds Lately and Activity; an index of them would be
      // noise.
      if (home.id && section.id === home.id) continue
      if (!inScope(section.id)) continue

      const front = await ensureOwnedPage(ctx, {
        pages,
        userId,
        sectionId: section.id,
        role: 'section_index',
        title: SECTION_INDEX_TITLE,
      })
      if (!front) continue

      const sectionTopics = topics
        .filter((topic) => topic.section_id === section.id)
        .map((topic) => ({
          pageId: topic.id,
          title: topic.title,
          count: (membersByTopic.get(topic.id) ?? []).length,
        }))
      const recent = captures
        .filter((capture) => capture.section_id === section.id)
        .map((capture) => entryById.get(capture.id))
        .filter((entry): entry is CatalogEntry => Boolean(entry))

      await writeOwnedPage(
        ctx,
        front,
        renderSectionIndex({ topics: sectionTopics, recent, timeZone }),
        {
          kind: 'section_rebuilt',
          target_page_id: front.id,
          summary: `rebuilt ${section.title}: ${sectionTopics.length} topic(s), ${recent.length} saved item(s)`,
        },
      )
      summary.sectionsRebuilt += 1
    }

    // --- 6. Lately. Disposable by design: rewritten every run, never accumulating. ---
    const lately = await ensureOwnedPage(ctx, {
      pages,
      userId,
      sectionId: home.id,
      role: 'lately',
      title: 'Lately',
      sortOrder: -2,
    })
    if (lately) {
      const cutoff = now.getTime() - LATELY_WINDOW_MS
      const bySection = sections.map((section) => ({
        sectionTitle: section.title,
        entries: captures
          .filter(
            (capture) =>
              capture.section_id === section.id &&
              (Date.parse(capture.created_at ?? '') || 0) >= cutoff,
          )
          .map((capture) => entryById.get(capture.id))
          .filter((entry): entry is CatalogEntry => Boolean(entry)),
      }))

      // NO SUGGESTIONS HERE. They used to be pure word-counting rendered into
      // this page; they are now model-noticed rows rendered by a React panel
      // beside it (see _shared/librarySuggest.ts). That split is what keeps the
      // ZERO MODEL CALLS invariant at the top of this file true, and it is what
      // lets this run after every capture for free.
      const windowDays = Math.round(LATELY_WINDOW_MS / (24 * 60 * 60 * 1000))

      await writeOwnedPage(ctx, lately, renderLately({ windowDays, bySection }), {
        kind: 'lately_rebuilt',
        target_page_id: lately.id,
        summary:
          `last ${windowDays} days: ` +
          `${bySection.reduce((sum, group) => sum + group.entries.length, 0)} new`,
      })
      summary.latelyRebuilt = 1
    }

    // --- 7. Record what happened, then render the Activity page from it. ---
    // The page is ensured BEFORE the log is flushed, so "created the Activity
    // page" isn't dropped from the very log it belongs in.
    const activityPage = await ensureOwnedPage(ctx, {
      pages,
      userId,
      sectionId: home.id,
      role: 'activity',
      title: 'Activity',
      sortOrder: -1,
    })

    if (!dryRun && log.length) {
      const { error: activityError } = await supabase.from('library_activity').insert(
        log.map((entry) => ({
          user_id: userId,
          kind: entry.kind,
          target_page_id: entry.target_page_id,
          summary: entry.summary,
          prev_content: entry.prev_content ?? null,
        })),
      )
      if (activityError) console.error('activity insert failed:', activityError.message)
    }

    if (activityPage && !dryRun) {
      const { data: rows } = await supabase
        .from('library_activity')
        .select('kind, summary, created_at, target_page_id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(activityPageRows)

      const titleById = new Map(
        [...pages, ...ctx.created].map((page) => [page.id, page.title]),
      )
      const { error } = await supabase
        .from('pages')
        .update({
          content: renderActivity({
            rows: (rows ?? []).map((row: any) => ({
              kind: row.kind as string,
              summary: row.summary as string,
              created_at: row.created_at as string,
              target_page_id: row.target_page_id as string | null,
              targetTitle: titleById.get(row.target_page_id as string) ?? null,
            })),
            timeZone,
          }),
          updated_at: now.toISOString(),
          library_rebuilt_at: now.toISOString(),
        })
        .eq('id', activityPage.id)
      if (error) console.error('activity page write failed:', error.message)
    }

    return { summary, log }
  } catch (err) {
    console.error('library-rebuild error:', String(err))
    return fail(String(err).slice(0, 500))
  }
}
