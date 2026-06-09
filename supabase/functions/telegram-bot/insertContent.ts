// Pure-JSON insert helpers (no Deno / jsr imports) so they can be unit-tested
// with Vitest. Walks plain Tiptap JSON immutably — no ProseMirror view needed.
//
// Mirrors src/components/editor/aiInsertHelpers.js `buildAiInsertContent`, but:
//   - WITHOUT the yellow review-highlight mark: inserted content goes in clean.
//   - Operates on serialized JSON (the bot has no live editor), so placement is
//     resolved by walking the doc tree instead of resolving ProseMirror positions.

export type TiptapNode = {
  type?: string
  text?: string
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
}

export type Format = 'bullet_list' | 'task_list' | 'paragraphs'
export type Placement = 'after_block' | 'append_to_list'

function createNodeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2, 10)
}

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList'])

// The user highlights key dates in this cyan; the app treats a highlighted date
// as an explicit due date. Mirrors aiInsertHelpers.js `makeHighlightedTextNode`
// (same mark shape, different color — that one is the yellow review highlight).
const DATE_HIGHLIGHT_COLOR = '#67e8f9'

// Matches the {{date:…}} sentinel the model wraps a key date phrase in.
const DATE_TOKEN_RE = /\{\{date:([^}]*)\}\}/g

/**
 * Split an item string into inline text runs, turning each {{date:…}} token into
 * a cyan-highlighted run (the phrase inside the token) and leaving the rest plain.
 * Empty segments are dropped — ProseMirror rejects a text node with text:''.
 */
export function buildInlineRuns(text: string): TiptapNode[] {
  const runs: TiptapNode[] = []
  let lastIndex = 0

  const pushPlain = (segment: string) => {
    if (segment) runs.push({ type: 'text', text: segment })
  }

  for (const match of text.matchAll(DATE_TOKEN_RE)) {
    const start = match.index ?? 0
    pushPlain(text.slice(lastIndex, start))
    const phrase = (match[1] ?? '').trim()
    if (phrase) {
      runs.push({
        type: 'text',
        text: phrase,
        marks: [{ type: 'highlight', attrs: { color: DATE_HIGHLIGHT_COLOR } }],
      })
    }
    lastIndex = start + match[0].length
  }
  pushPlain(text.slice(lastIndex))

  return runs
}

function makeParagraph(text: string, createdAt: string): TiptapNode {
  return {
    type: 'paragraph',
    attrs: { id: createNodeId(), created_at: createdAt },
    // A text node with text:'' is invalid in ProseMirror; an empty paragraph is fine.
    content: buildInlineRuns(text),
  }
}

/**
 * Build the top-level nodes to insert. For list formats this is a single list
 * wrapper; for paragraphs it's one paragraph per item. Every block (and the
 * paragraph inside each list item) gets a fresh id + created_at.
 */
export function buildItems(format: Format, items: string[]): TiptapNode[] {
  const createdAt = new Date().toISOString()
  const clean = (items ?? []).map((s) => String(s ?? '').trim()).filter(Boolean)

  if (format === 'task_list') {
    return [
      {
        type: 'taskList',
        attrs: { id: createNodeId(), created_at: createdAt },
        content: clean.map((item) => ({
          type: 'taskItem',
          attrs: { checked: false },
          content: [makeParagraph(item, createdAt)],
        })),
      },
    ]
  }

  if (format === 'paragraphs') {
    return clean.map((item) => makeParagraph(item, createdAt))
  }

  // bullet_list (default)
  return [
    {
      type: 'bulletList',
      attrs: { id: createNodeId(), created_at: createdAt },
      content: clean.map((item) => ({
        type: 'listItem',
        content: [makeParagraph(item, createdAt)],
      })),
    },
  ]
}

// First child paragraph's id — the highlight anchor for an appended list item.
function innerParagraphId(item: TiptapNode): string | null {
  const para = (item.content ?? []).find((c) => c.type === 'paragraph')
  const id = para?.attrs?.id
  return typeof id === 'string' ? id : null
}

// Re-type list items to match the target list (bullet <-> task), preserving the
// inner paragraph (and its fresh id). Lets the proposer be slightly off on format.
function coerceItemsToListType(items: TiptapNode[], listType: string): TiptapNode[] {
  if (listType === 'taskList') {
    return items.map((item) => ({
      type: 'taskItem',
      attrs: { checked: false },
      content: item.content ?? [],
    }))
  }
  // bulletList / orderedList both use listItem
  return items.map((item) => ({
    type: 'listItem',
    content: item.content ?? [],
  }))
}

/**
 * Insert `nodes` (from buildItems) into `doc` relative to the block with
 * `targetBlockId`, immutably. Returns the new doc and the top-level block ids of
 * the inserted content (to highlight in the preview).
 *
 * placement:
 *   - 'after_block'    insert nodes right after the target in its parent array.
 *   - 'append_to_list' target is a list; append its items as new list items
 *                      (only the new lines are highlighted, not the whole list).
 *
 * If the target block can't be found (e.g. the user deleted it since the
 * proposal), returns the original doc with an empty insertedBlockIds — the
 * caller should treat that as "the tracker changed, re-propose".
 *
 * A null targetBlockId appends the nodes to the end of the document.
 */
export function insertRelativeToBlock(
  doc: TiptapNode,
  targetBlockId: string | null,
  placement: Placement,
  nodes: TiptapNode[],
): { doc: TiptapNode; insertedBlockIds: string[] } {
  if (!doc || typeof doc !== 'object') return { doc, insertedBlockIds: [] }

  if (!targetBlockId) {
    const insertedBlockIds = nodes.map((n) => n.attrs?.id).filter((v): v is string => typeof v === 'string')
    return { doc: { ...doc, content: [...(doc.content ?? []), ...nodes] }, insertedBlockIds }
  }

  let matched = false
  let insertedBlockIds: string[] = []

  const topLevelIds = (): string[] =>
    nodes.map((n) => n.attrs?.id).filter((v): v is string => typeof v === 'string')

  const transform = (node: TiptapNode): TiptapNode => {
    if (!Array.isArray(node.content)) return node
    const newContent: TiptapNode[] = []

    for (const child of node.content) {
      if (!matched && child.attrs?.id === targetBlockId) {
        const wrapper = nodes[0]
        const canAppend =
          placement === 'append_to_list' &&
          LIST_TYPES.has(child.type ?? '') &&
          wrapper &&
          LIST_TYPES.has(wrapper.type ?? '') &&
          Array.isArray(wrapper.content)

        if (canAppend) {
          const coerced = coerceItemsToListType(wrapper.content as TiptapNode[], child.type ?? '')
          insertedBlockIds = coerced
            .map(innerParagraphId)
            .filter((v): v is string => typeof v === 'string')
          newContent.push({ ...child, content: [...(child.content ?? []), ...coerced] })
          matched = true
          continue
        }

        // after_block (and the fallback when append was requested but the target
        // isn't a list, or formats don't line up): keep the target, insert after.
        insertedBlockIds = topLevelIds()
        newContent.push(transform(child))
        newContent.push(...nodes)
        matched = true
        continue
      }

      newContent.push(transform(child))
    }

    return { ...node, content: newContent }
  }

  const newDoc = transform(doc)
  if (!matched) return { doc, insertedBlockIds: [] }
  return { doc: newDoc, insertedBlockIds }
}
