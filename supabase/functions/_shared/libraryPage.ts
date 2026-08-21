// Pure Tiptap-document construction for Library pages.
//
// HOUSE RULE: zero jsr:/npm:/https:// imports, zero top-level `Deno.*`, so
// Vitest imports this directly and the weekly rebuild (an edge function) and the
// bot can share one implementation.
//
// THE STRUCTURE IS THE SAFETY PROPERTY. A capture page has exactly one
// human-written region — "My notes" — and the weekly rebuild never writes
// capture pages at all. Topic pages, section front pages, Lately, and Activity
// are 100% model-owned and regenerated wholesale. Nothing the user wrote is ever
// at risk, because of where it lives rather than because of a rule someone has
// to remember.

export type TiptapNode = {
  type?: string
  text?: string
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
}

/** Section headings on a capture page. Matched by text when appending a note. */
export const CAPTURE_HEADINGS = {
  summary: 'Summary',
  notes: 'My notes',
  source: 'Source',
} as const

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2, 10)
}

export function heading(text: string, level = 2): TiptapNode {
  return {
    type: 'heading',
    attrs: { id: newId(), level },
    content: [{ type: 'text', text }],
  }
}

export function paragraph(content: TiptapNode[] | string): TiptapNode {
  const inline = typeof content === 'string'
    ? content
      ? [{ type: 'text', text: content }]
      : []
    : content
  return { type: 'paragraph', attrs: { id: newId() }, content: inline }
}

export function link(text: string, href: string): TiptapNode {
  return {
    type: 'text',
    text,
    marks: [{ type: 'link', attrs: { href, target: '_blank', class: null } }],
  }
}

export function bulletList(items: Array<TiptapNode[] | string>): TiptapNode {
  return {
    type: 'bulletList',
    attrs: { id: newId() },
    content: items.map((item) => ({
      type: 'listItem',
      content: [paragraph(item)],
    })),
  }
}

/** "Aug 19" — how a dated note is labelled, in the user's own zone. */
export function shortDateLabel(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
  }).format(now)
}

export type CaptureSource = {
  sourceType?: string | null
  url?: string | null
  title?: string | null
  site?: string | null
  author?: string | null
  published?: string | null
  episodeNumber?: number | null
  duration?: string | null
  extractStatus?: string | null
}

/** The "Source" line: a link out, plus whatever provenance we actually have. */
function sourceBlocks(source: CaptureSource): TiptapNode[] {
  const label = source.title || source.url || 'Source'
  const linkNode: TiptapNode[] = source.url
    ? [link(label, source.url)]
    : [{ type: 'text', text: label }]

  const provenance = [
    source.site,
    source.author,
    source.episodeNumber != null ? `Episode ${source.episodeNumber}` : null,
    source.published,
    source.duration,
  ]
    .filter(Boolean)
    .join(' · ')

  const blocks = [paragraph(linkNode)]
  if (provenance) blocks.push(paragraph(provenance))

  // Say so on the page, not just in a column: a capture whose source could not
  // be read should look different from one that was read fine.
  if (source.extractStatus && source.extractStatus !== 'ok') {
    const note =
      source.extractStatus === 'blocked'
        ? "Couldn't read the full text — the site blocked it. The link and your notes are here."
        : source.extractStatus === 'thin'
          ? "Only got a stub of the full text. The link and your notes are here."
          : source.extractStatus === 'none'
            ? 'No link — this is a note.'
            : "Couldn't read the source. The link and your notes are here."
    blocks.push(paragraph(note))
  }

  return blocks
}

/**
 * Build a capture page.
 *
 * `summary` is model-written and never rewritten after ingest. `note` is the
 * user's own thought and is the ONLY human-authored text in the whole Library —
 * everything downstream must treat it as untouchable.
 */
export function buildCapturePage(params: {
  summary: string
  note?: string | null
  source: CaptureSource
  dateLabel: string
}): TiptapNode {
  const { summary, note, source, dateLabel } = params

  const content: TiptapNode[] = [
    heading(CAPTURE_HEADINGS.summary),
    paragraph(summary || 'No summary available.'),
    heading(CAPTURE_HEADINGS.notes),
    bulletList(note?.trim() ? [`${dateLabel} — ${note.trim()}`] : ['']),
    heading(CAPTURE_HEADINGS.source),
    ...sourceBlocks(source),
  ]

  return { type: 'doc', content }
}

function isHeadingWithText(node: TiptapNode, text: string): boolean {
  if (node.type !== 'heading') return false
  const flat = (node.content ?? []).map((child) => child.text ?? '').join('').trim()
  return flat.toLowerCase() === text.toLowerCase()
}

/**
 * Append a dated note to an existing capture's "My notes" list, immutably.
 *
 * This is what makes multi-note work: the source is the page, and the user's
 * thoughts are dated entries on it. If the list isn't found (the user
 * restructured the page, which is their right), the note is appended at the end
 * rather than dropped.
 *
 * Returns the block id of the new line so the preview can highlight it.
 */
export function appendDatedNote(
  doc: TiptapNode,
  note: string,
  dateLabel: string,
): { doc: TiptapNode; blockId: string | null } {
  const text = `${dateLabel} — ${String(note ?? '').trim()}`
  const item = { type: 'listItem', content: [paragraph(text)] } as TiptapNode
  const blockId = (item.content?.[0]?.attrs?.id as string) ?? null

  const top = Array.isArray(doc?.content) ? doc.content : []

  // Find the "My notes" heading, then the first list after it.
  const headingIndex = top.findIndex((node) => isHeadingWithText(node, CAPTURE_HEADINGS.notes))
  if (headingIndex !== -1) {
    for (let i = headingIndex + 1; i < top.length; i++) {
      const node = top[i]
      if (node.type === 'heading') break // ran into the next section
      if (node.type === 'bulletList' || node.type === 'taskList') {
        // Drop a placeholder empty first item if this is the first real note.
        const existing = (node.content ?? []).filter((entry) => {
          const flat = (entry.content ?? [])
            .flatMap((child) => child.content ?? [])
            .map((child) => child.text ?? '')
            .join('')
            .trim()
          return flat.length > 0
        })
        const nextList = { ...node, content: [...existing, item] }
        const nextTop = [...top]
        nextTop[i] = nextList
        return { doc: { ...doc, content: nextTop }, blockId }
      }
    }
    // Heading exists but no list under it — insert one right after the heading.
    const list = bulletList([text])
    const inner = list.content?.[0]?.content?.[0]?.attrs?.id as string | undefined
    const nextTop = [...top]
    nextTop.splice(headingIndex + 1, 0, list)
    return { doc: { ...doc, content: nextTop }, blockId: inner ?? null }
  }

  // No notes section at all: add one at the end rather than losing the note.
  const list = bulletList([text])
  const inner = list.content?.[0]?.content?.[0]?.attrs?.id as string | undefined
  return {
    doc: { ...doc, content: [...top, heading(CAPTURE_HEADINGS.notes), list] },
    blockId: inner ?? null,
  }
}
