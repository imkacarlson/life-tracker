// Cross off a block in a Tiptap doc — the "done" reply's write path.
//
// Sibling of insertContent.ts `insertRelativeToBlock`: pure, immutable, walks
// plain JSON. HOUSE RULE: zero jsr:/npm:/https:// imports, zero top-level `Deno.*`.

export type TiptapNode = {
  type?: string
  text?: string
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
}

const strikeAllText = (node: TiptapNode): TiptapNode => {
  if (node?.type === 'text') {
    const marks = node.marks ?? []
    if (marks.some((m) => m?.type === 'strike')) return node // already struck
    return { ...node, marks: [...marks, { type: 'strike' }] }
  }
  if (!Array.isArray(node?.content)) return node
  return { ...node, content: node.content.map(strikeAllText) }
}

/**
 * Strike every text node inside the block with `blockId`, matching the user's own
 * convention (they cross items off rather than deleting them). If that block sits
 * directly inside a taskItem, the checkbox is ticked too.
 *
 * Idempotent: an already-struck block comes back unchanged. An unknown id returns
 * the original doc with `found: false`.
 */
export function strikeBlock(
  doc: TiptapNode,
  blockId: string,
): { doc: TiptapNode; found: boolean } {
  if (!doc || typeof doc !== 'object' || !blockId) return { doc, found: false }

  let found = false

  const transform = (node: TiptapNode): TiptapNode => {
    if (!Array.isArray(node.content)) return node

    const content = node.content.map((child) => {
      if (!found && child?.attrs?.id === blockId) {
        found = true
        return strikeAllText(child)
      }
      return transform(child)
    })

    const next: TiptapNode = { ...node, content }
    // The struck block was one of MY children — if I'm a taskItem, tick me.
    if (found && next.type === 'taskItem' && next.attrs?.checked !== true) {
      const hitHere = node.content.some((child) => child?.attrs?.id === blockId)
      if (hitHere) next.attrs = { ...(next.attrs ?? {}), checked: true }
    }
    return next
  }

  const nextDoc = transform(doc)
  return found ? { doc: nextDoc, found: true } : { doc, found: false }
}
