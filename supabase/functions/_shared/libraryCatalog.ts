// Rendering the model-owned Library pages: topic catalogs, section front pages,
// and Lately.
//
// HOUSE RULE: zero jsr:/npm:/https:// imports, zero top-level `Deno.*`. Pure in,
// pure out — the weekly rebuild is a thin shell over this.
//
// ============================================================================
// CATALOG, NEVER ASSERT. This is the constraint the whole feature turns on.
//
// These pages LIST and GROUP what the user saved, quoting their own notes, with
// dates. They never state a conclusion, never say what the consensus is, never
// give advice. An earlier prototype wrote "consensus is that trained-gut runners
// tolerate more than 30–60g" and was rejected as busy work — correctly, because
// that is the model telling the user what is true, which is not what was asked
// for. The ask was recall: "I know I saved something about this — what was it?"
//
// Everything below is therefore a rendering of stored data. There is deliberately
// no place in this module where a model writes a sentence of its own.
// ============================================================================

import { bulletList, heading, paragraph } from './libraryPage.ts'
import type { TiptapNode } from './libraryPage.ts'

/** What kind of thing a capture is. Mirrors library_sources.source_type, whose
 *  CHECK constraint allows exactly these four. */
export type CatalogKind = 'article' | 'podcast' | 'note' | 'thread'

/** One capture, as a topic catalog sees it. */
export type CatalogEntry = {
  pageId: string
  title: string
  /** ISO timestamp the capture was created. */
  savedAt: string
  /** Where it came from — "example.com", "Long Run Radio". */
  site?: string | null
  /** article / podcast / note / thread, rendered as a plain word. Knowing a line
   *  is a podcast rather than an article is most of what makes a long list
   *  skimmable, and it costs nothing — it was recorded at ingest. */
  kind?: CatalogKind | string | null
  /** Why this capture was filed into the topic being rendered. Written once, at
   *  the moment membership was decided, and stored on the membership row — so it
   *  is only ever set when rendering THAT topic's catalog. */
  reason?: string | null
  /** The user's own dated notes on the capture. Quoted verbatim, never rewritten. */
  notes?: Array<{ date: string; text: string }>
}

/** The four kinds, as words. "Own note" rather than "Note": on a list where every
 *  other line came from somewhere else, what matters is that this one didn't. */
const KIND_LABELS: Record<string, string> = {
  article: 'Article',
  podcast: 'Podcast',
  note: 'Own note',
  thread: 'Thread',
}

/** The display word for a source kind, or null for an unknown/absent one. */
export function kindLabel(kind: string | null | undefined): string | null {
  return KIND_LABELS[String(kind ?? '')] ?? null
}

/** An internal app link to a page. Matches the hash format parseDeepLink expects. */
function pageLink(text: string, pageId: string): TiptapNode {
  return {
    type: 'text',
    text,
    marks: [{ type: 'link', attrs: { href: `#pg=${pageId}`, target: '_self', class: null } }],
  }
}

/**
 * The one line that appears at the top of every model-owned page.
 *
 * These pages are regenerated wholesale, so an edit made here is lost the next
 * time something is saved. Saying so is cheaper than the alternatives (locking
 * the page, diffing it, asking) and it doubles as a signpost: it names where
 * the user's own writing DOES live, which is the capture page's "My notes" —
 * the one region no rebuild ever touches.
 */
export const REBUILD_NOTE =
  'This page is written by the app and rewritten whenever something new is saved — ' +
  'anything you type here will be replaced. Your own words live on the saved pages, under “My notes”.'

/** Stone 400 (DESIGN.md "muted text"). Present, not shouting. */
const REBUILD_NOTE_COLOR = '#A8A29E'

function rebuildNote(): TiptapNode {
  return paragraph([
    {
      type: 'text',
      text: REBUILD_NOTE,
      marks: [{ type: 'italic' }, { type: 'textStyle', attrs: { color: REBUILD_NOTE_COLOR } }],
    },
  ])
}

/** "August 2026" — the grouping key, in the user's zone. */
export function monthLabel(iso: string, timeZone: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Undated'
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function sortNewestFirst(entries: CatalogEntry[]): CatalogEntry[] {
  return [...entries].sort((a, b) => {
    const at = new Date(a.savedAt).getTime() || 0
    const bt = new Date(b.savedAt).getTime() || 0
    return bt - at
  })
}

/** Group entries by the month they were saved, newest month first. */
export function groupByMonth(
  entries: CatalogEntry[],
  timeZone: string,
): Array<{ label: string; entries: CatalogEntry[] }> {
  const groups: Array<{ label: string; entries: CatalogEntry[] }> = []
  for (const entry of sortNewestFirst(entries)) {
    const label = monthLabel(entry.savedAt, timeZone)
    const existing = groups.find((group) => group.label === label)
    if (existing) existing.entries.push(entry)
    else groups.push({ label, entries: [entry] })
  }
  return groups
}

/**
 * One catalog line: a link to the capture, its source, and the user's own notes
 * quoted with their dates.
 *
 * The notes are the point. They are the only human-written text in the Library,
 * and they are what makes a six-month-old capture recognizable — far more than
 * a title or a model-written summary.
 */
function entryLine(entry: CatalogEntry): TiptapNode[] {
  const parts: TiptapNode[] = [pageLink(entry.title, entry.pageId)]

  // "— Podcast · Long Run Radio". Either half may be missing.
  const source = [kindLabel(entry.kind), entry.site].filter(Boolean).join(' · ')
  if (source) parts.push({ type: 'text', text: ` — ${source}` })

  // Why it was filed here, when this is a topic catalog. Unquoted and undated so
  // it can never be mistaken for one of the user's own notes below.
  const reason = String(entry.reason ?? '').trim()
  if (reason) parts.push({ type: 'text', text: ` · filed here: ${reason}` })

  for (const note of entry.notes ?? []) {
    const text = String(note.text ?? '').trim()
    if (!text) continue
    // Quoted, never paraphrased: these are the user's words.
    parts.push({ type: 'text', text: ` · ${note.date}: “${text}”` })
  }
  return parts
}

const EMPTY_TOPIC =
  'Nothing filed here yet. Save something to this section and it will show up.'

/**
 * Render a topic catalog page.
 *
 * Input is stored membership (see library_topic_members) — this function never
 * decides what belongs, it only lays out what was already decided.
 */
export function renderTopicCatalog(params: {
  entries: CatalogEntry[]
  timeZone: string
}): TiptapNode {
  const { entries, timeZone } = params
  if (!entries.length) {
    return { type: 'doc', content: [rebuildNote(), paragraph(EMPTY_TOPIC)] }
  }

  const content: TiptapNode[] = [rebuildNote()]
  for (const group of groupByMonth(entries, timeZone)) {
    content.push(heading(group.label, 3))
    content.push(bulletList(group.entries.map(entryLine)))
  }
  return { type: 'doc', content }
}

const flattenText = (node: TiptapNode | undefined): string => {
  if (!node) return ''
  if (node.text) return node.text
  return (node.content ?? []).map(flattenText).join('')
}

/**
 * Pull the user's dated notes back off a capture page.
 *
 * The notes are the only human-written text in the Library and they are what
 * makes a six-month-old capture recognizable, so a catalog quotes them rather
 * than the model-written summary.
 */
export function extractNotes(content: TiptapNode | null | undefined): Array<{ date: string; text: string }> {
  const top = content?.content ?? []
  const headingIndex = top.findIndex(
    (node) => node.type === 'heading' && flattenText(node).trim().toLowerCase() === 'my notes',
  )
  if (headingIndex === -1) return []

  const notes: Array<{ date: string; text: string }> = []
  for (let i = headingIndex + 1; i < top.length; i++) {
    const node = top[i]
    if (node.type === 'heading') break
    if (node.type !== 'bulletList' && node.type !== 'taskList') continue
    for (const item of node.content ?? []) {
      const line = flattenText(item).trim()
      if (!line) continue
      // "Aug 19 — the thought they sent"
      const match = /^(.{2,12}?)\s+[—-]\s+(.*)$/.exec(line)
      if (match) notes.push({ date: match[1].trim(), text: match[2].trim() })
      else notes.push({ date: '', text: line })
    }
  }
  return notes
}

/** Turn capture pages into catalog entries. */
export function toCatalogEntries(
  pages: Array<{ id: string; title: string; content: TiptapNode; created_at: string }>,
  sourcesByPageId: Map<string, { site?: string | null; kind?: string | null }> = new Map(),
): CatalogEntry[] {
  return pages.map((page) => ({
    pageId: page.id,
    title: page.title,
    savedAt: page.created_at,
    site: sourcesByPageId.get(page.id)?.site ?? null,
    kind: sourcesByPageId.get(page.id)?.kind ?? null,
    notes: extractNotes(page.content),
  }))
}

export type SectionTopic = { pageId: string; title: string; count: number }

/** How many entries "Landed recently" lists before it stops and says how many
 *  more there are. A front page is a way in, not the whole section. */
const RECENT_LIMIT = 15

/**
 * Said when a section has no topics yet.
 *
 * The Topics block used to be omitted entirely in this case, which left the
 * front page as a bare list of recent saves — and made the whole topic mechanism
 * invisible to anyone who hadn't already been told about it. Naming how a topic
 * comes into being is the one thing this page can do about that, and it stays
 * inside the catalog-never-assert rule: it describes the app, not the content.
 *
 * It names the BUTTON first, because there is now one directly above this page:
 * the "Worth a topic?" block. Sending the reader to Telegram while a card sat a
 * few centimetres higher would be the app not knowing what it looks like.
 */
const NO_TOPICS_YET =
  'No topics in this section yet. Topics exist only because you made one — use “Worth a topic?” ' +
  'above, or tell the bot “make a topic for …”. What is already saved here gets filed into it as ' +
  'new things arrive.'

/**
 * Render a section's front page: its topics, then what arrived recently.
 *
 * `count` is passed in but rendered as plain context ("3 saved"), never as a
 * badge and never as something to act on. Nothing in the Library is a queue.
 */
export function renderSectionIndex(params: {
  topics: SectionTopic[]
  recent: CatalogEntry[]
  timeZone: string
}): TiptapNode {
  const { topics, recent } = params
  const content: TiptapNode[] = [rebuildNote()]

  content.push(heading('Topics', 3))
  if (topics.length) {
    content.push(
      bulletList(
        topics.map((topic) => {
          const parts: TiptapNode[] = [pageLink(topic.title, topic.pageId)]
          if (topic.count > 0) {
            parts.push({ type: 'text', text: ` — ${topic.count} saved` })
          }
          return parts
        }),
      ),
    )
  } else {
    content.push(paragraph(NO_TOPICS_YET))
  }

  if (recent.length) {
    const sorted = sortNewestFirst(recent)
    content.push(heading('Landed recently', 3))
    content.push(bulletList(sorted.slice(0, RECENT_LIMIT).map(entryLine)))
    // Say what was left out. Silently truncating at 15 makes a section with 200
    // things in it look identical to one with 15.
    const older = sorted.length - RECENT_LIMIT
    if (older > 0) {
      content.push(paragraph(`${older} older — search the section.`))
    }
  } else {
    content.push(paragraph('Nothing saved in this section yet.'))
  }

  return { type: 'doc', content }
}

/**
 * Render Lately: what has arrived recently, grouped by section.
 *
 * DISPOSABLE BY DESIGN. Lately is rewritten on every rebuild and never
 * accumulates. That is deliberate: an accumulating "new since you last looked"
 * page is a queue, and there is nothing in the Library to catch up on.
 *
 * The window is named by its LENGTH, not by its start date. "Saved since Jul 21"
 * is a true sentence that tells you nothing: the reader has to work out what
 * Jul 21 is and why, and it changes every single run. "Last 30 days" is the
 * same fact in the form the reader actually holds it in — and it is what the
 * design mock said.
 *
 * WHAT IS NOT HERE: "want a topic for that?". Suggestions used to be a text
 * block on this page, written by pure word-counting. They are now cards in a
 * React panel beside the page, fed by library_suggestions — because a
 * suggestion's `why` is a model-written sentence, and the guarantee at the top
 * of this module is that no model writes a sentence of its own in here. A
 * suggestion is also a CONTROL, not content: it should not survive into stored
 * page JSON, into an export, or as residue after it is dismissed.
 */
export function renderLately(params: {
  windowDays: number
  bySection: Array<{ sectionTitle: string; entries: CatalogEntry[] }>
}): TiptapNode {
  const { windowDays, bySection } = params
  const window = `the last ${windowDays} days`
  const content: TiptapNode[] = [rebuildNote(), paragraph(`What landed in ${window}.`)]

  const withEntries = bySection.filter((group) => group.entries.length)
  if (!withEntries.length) {
    content.push(paragraph(`Nothing new in ${window}.`))
  } else {
    for (const group of withEntries) {
      content.push(heading(group.sectionTitle, 3))
      content.push(bulletList(sortNewestFirst(group.entries).map(entryLine)))
    }
  }

  return { type: 'doc', content }
}

export type ActivityRow = {
  kind: string
  summary: string
  created_at: string
  target_page_id?: string | null
  targetTitle?: string | null
}

/**
 * Render the Activity log page — newest first, one line each.
 *
 * Silent self-rewriting only earns trust if it is inspectable. This page and the
 * stored prev_content behind it are what make the weekly rebuild reversible
 * rather than something the user has to take on faith.
 */
export function renderActivity(params: { rows: ActivityRow[]; timeZone: string }): TiptapNode {
  const { rows, timeZone } = params
  if (!rows.length) {
    return { type: 'doc', content: [rebuildNote(), paragraph('Nothing has been rebuilt yet.')] }
  }

  const stamp = (iso: string) => {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return '—'
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date)
  }

  return {
    type: 'doc',
    content: [
      rebuildNote(),
      bulletList(
        rows.map((row) => {
          const parts: TiptapNode[] = [{ type: 'text', text: `${stamp(row.created_at)} — ` }]
          if (row.target_page_id && row.targetTitle) {
            parts.push(pageLink(row.targetTitle, row.target_page_id))
            parts.push({ type: 'text', text: `: ${row.summary}` })
          } else {
            parts.push({ type: 'text', text: row.summary })
          }
          return parts
        }),
      ),
    ],
  }
}
