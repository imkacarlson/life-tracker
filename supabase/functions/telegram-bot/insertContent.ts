// Pure-JSON insert helpers (no Deno / jsr imports) so they can be unit-tested
// with Vitest. Walks plain Tiptap JSON immutably — no ProseMirror view needed.
//
// Mirrors src/components/editor/aiInsertHelpers.js `buildAiInsertContent`, but:
//   - WITHOUT the yellow review-highlight mark: inserted content goes in clean.
//   - Operates on serialized JSON (the bot has no live editor), so placement is
//     resolved by walking the doc tree instead of resolving ProseMirror positions.

import { DATE_HIGHLIGHT_COLOR, splitDateTokens } from '../_shared/dateToken.ts'

export type TiptapNode = {
  type?: string
  text?: string
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
}

export type Format = 'bullet_list' | 'task_list' | 'paragraphs'
export type Placement = 'after_block' | 'append_to_list' | 'into_category' | 'new_category'
export type InsertOptions = { category?: string }

function createNodeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2, 10)
}

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList'])

/**
 * Split an item string into inline text runs, turning each {{date:…}} token into
 * a cyan-highlighted run (the phrase inside the token) and leaving the rest plain.
 *
 * The token splitting itself lives in _shared/dateToken.ts because the bot's
 * "⏰ I'll text you…" confirmation runs the SAME split through the reminder
 * deriver — so the bot can't promise a reminder the cron won't send.
 * Mirrors aiInsertHelpers.js `makeHighlightedTextNode` (same mark shape,
 * different color — that one is the yellow review highlight).
 */
export function buildInlineRuns(text: string): TiptapNode[] {
  return splitDateTokens(text).map((run) =>
    run.isDate
      ? {
          type: 'text',
          text: run.text,
          marks: [{ type: 'highlight', attrs: { color: DATE_HIGHLIGHT_COLOR } }],
        }
      : { type: 'text', text: run.text },
  )
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

function plainText(node: TiptapNode): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(plainText).join('')
}

const compareTitles = (a: string, b: string): number =>
  a.trim().localeCompare(b.trim(), undefined, { sensitivity: 'base' })

const paragraphIds = (items: TiptapNode[]): string[] =>
  items.map(innerParagraphId).filter((v): v is string => typeof v === 'string')

// Append list items to the bottom of a list item's nested list, creating that
// list when the item has none yet (an empty category). Returns the new item and
// the inner paragraph ids of what was added.
function appendUnderItem(item: TiptapNode, wrapper: TiptapNode): { item: TiptapNode; ids: string[] } {
  const children = item.content ?? []
  const sub = children.find((c) => LIST_TYPES.has(c.type ?? ''))
  if (sub) {
    const coerced = coerceItemsToListType(wrapper.content ?? [], sub.type ?? '')
    return {
      item: {
        ...item,
        content: children.map((c) => (c === sub ? { ...sub, content: [...(sub.content ?? []), ...coerced] } : c)),
      },
      ids: paragraphIds(coerced),
    }
  }
  return { item: { ...item, content: [...children, wrapper] }, ids: paragraphIds(wrapper.content ?? []) }
}

/**
 * Insert `nodes` (from buildItems) into `doc` relative to the block with
 * `targetBlockId`, immutably. Returns the new doc and the block ids of the
 * inserted content (to highlight in the preview).
 *
 * placement:
 *   - 'after_block'    insert right after the target. When the target is a list
 *                      line, the new items become SIBLINGS at that line's level
 *                      (never nested under it); if the list kinds differ (a
 *                      bullet after a checkbox line) the new list goes right
 *                      after the whole list instead, still at the same level.
 *   - 'append_to_list' target is a list; append its items as new list items
 *                      (only the new lines are highlighted, not the whole list).
 *   - 'into_category'  target is a category line (a list item's own line);
 *                      append to the bottom of the list nested under it,
 *                      creating that list when the category is empty.
 *   - 'new_category'   target is the list that holds the categories; add a bold
 *                      `opts.category` item in alphabetical position with the
 *                      items under it. If that category already exists, the
 *                      items are appended to it instead (createdCategory tells
 *                      the two apart).
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
  opts: InsertOptions = {},
): { doc: TiptapNode; insertedBlockIds: string[]; createdCategory?: boolean } {
  if (!doc || typeof doc !== 'object') return { doc, insertedBlockIds: [] }

  if (!targetBlockId) {
    const insertedBlockIds = nodes.map((n) => n.attrs?.id).filter((v): v is string => typeof v === 'string')
    return { doc: { ...doc, content: [...(doc.content ?? []), ...nodes] }, insertedBlockIds }
  }

  let matched = false
  let insertedBlockIds: string[] = []
  let createdCategory = false
  // A bullet added after a checkbox line can't live inside the checkbox list, so
  // it's parked here and emitted right after that list by the list's parent.
  let deferred: { owner: TiptapNode; nodes: TiptapNode[] } | null = null

  const wrapper = nodes[0]
  const wrapperIsList = Boolean(wrapper && LIST_TYPES.has(wrapper.type ?? '') && Array.isArray(wrapper.content))
  const categoryTitle = (opts.category ?? '').trim()

  const topLevelIds = (): string[] =>
    nodes.map((n) => n.attrs?.id).filter((v): v is string => typeof v === 'string')

  const addCategory = (list: TiptapNode): TiptapNode => {
    const items = list.content ?? []
    const existing = items.findIndex((item) => compareTitles(plainText(item.content?.[0] ?? {}), categoryTitle) === 0)
    if (existing !== -1) {
      const { item, ids } = appendUnderItem(items[existing], wrapper)
      insertedBlockIds = ids
      return { ...list, content: items.map((it, i) => (i === existing ? item : it)) }
    }
    const heading: TiptapNode = {
      type: 'paragraph',
      attrs: { id: createNodeId(), created_at: new Date().toISOString() },
      content: [{ type: 'text', text: categoryTitle, marks: [{ type: 'bold' }] }],
    }
    const category: TiptapNode =
      list.type === 'taskList'
        ? { type: 'taskItem', attrs: { checked: false }, content: [heading, wrapper] }
        : { type: 'listItem', content: [heading, wrapper] }
    let at = items.findIndex((item) => compareTitles(plainText(item.content?.[0] ?? {}), categoryTitle) > 0)
    if (at === -1) at = items.length
    insertedBlockIds = [heading.attrs?.id as string, ...paragraphIds(wrapper.content ?? [])]
    createdCategory = true
    return { ...list, content: [...items.slice(0, at), category, ...items.slice(at)] }
  }

  const transform = (node: TiptapNode): TiptapNode => {
    if (!Array.isArray(node.content)) return node
    const newContent: TiptapNode[] = []
    const isList = LIST_TYPES.has(node.type ?? '')

    for (const child of node.content) {
      // Target is a list line: its id sits on the item's first paragraph, so
      // handle it here, where the item's list is known.
      if (!matched && isList && wrapperIsList && innerParagraphId(child) === targetBlockId) {
        if (placement === 'into_category') {
          const { item, ids } = appendUnderItem(child, wrapper)
          insertedBlockIds = ids
          newContent.push(item)
          matched = true
          continue
        }
        if (placement === 'after_block' || placement === 'append_to_list') {
          matched = true
          const sameKind = (node.type === 'taskList') === (wrapper.type === 'taskList')
          if (sameKind) {
            const coerced = coerceItemsToListType(wrapper.content as TiptapNode[], node.type ?? '')
            insertedBlockIds = paragraphIds(coerced)
            newContent.push(transform(child), ...coerced)
          } else {
            insertedBlockIds = topLevelIds()
            deferred = { owner: node, nodes }
            newContent.push(transform(child))
          }
          continue
        }
      }

      if (!matched && child.attrs?.id === targetBlockId) {
        if (placement === 'new_category' && categoryTitle && wrapperIsList && LIST_TYPES.has(child.type ?? '')) {
          newContent.push(addCategory(child))
          matched = true
          continue
        }

        const canAppend =
          (placement === 'append_to_list' || placement === 'into_category') &&
          LIST_TYPES.has(child.type ?? '') &&
          wrapperIsList

        if (canAppend) {
          const coerced = coerceItemsToListType(wrapper.content as TiptapNode[], child.type ?? '')
          insertedBlockIds = paragraphIds(coerced)
          newContent.push({ ...child, content: [...(child.content ?? []), ...coerced] })
          matched = true
          continue
        }

        // after_block (and the fallback when another placement doesn't fit the
        // target): keep the target, insert after it.
        insertedBlockIds = topLevelIds()
        newContent.push(transform(child))
        newContent.push(...nodes)
        matched = true
        continue
      }

      newContent.push(transform(child))
      if (deferred && deferred.owner === child) {
        newContent.push(...deferred.nodes)
        deferred = null
      }
    }

    return { ...node, content: newContent }
  }

  const newDoc = transform(doc)
  if (!matched) return { doc, insertedBlockIds: [] }
  return { doc: newDoc, insertedBlockIds, ...(createdCategory ? { createdCategory } : {}) }
}
