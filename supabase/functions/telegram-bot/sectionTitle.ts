// Pure helper (no Deno / jsr imports) so it can be unit-tested with Vitest like
// insertContent.ts / trackerText.ts. Resolves which category/section a proposed
// addition lands in, so the preview photo's caption can name it.
//
// The preview screenshot is cropped to the highlighted block + ~160px of context,
// which often hides the enclosing category title — so we resolve it here, in code,
// from the pre-insert doc + the anchor the model picked.

type TiptapNode = {
  type?: string
  text?: string
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
}

// Concatenate the text of all descendant text nodes — plain, with no markdown.
// Deliberately NOT serializeInline (trackerText.ts): that injects **/[] markers,
// which we don't want in a caption that gets bolded separately.
function plainText(node: TiptapNode): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(plainText).join('')
}

const hasBoldRun = (p: TiptapNode): boolean =>
  (p.content ?? []).some((run) => run.type === 'text' && (run.marks ?? []).some((m) => m.type === 'bold'))

// A list item whose own line is entirely bold is a category ("**Jerry Updates**").
function categoryTitleOfItem(item: TiptapNode): string | null {
  if (item.type !== 'listItem' && item.type !== 'taskItem') return null
  const first = item.content?.[0]
  if (first?.type !== 'paragraph') return null
  const runs = (first.content ?? []).filter((r) => r.type === 'text' && (r.text ?? '').trim())
  if (!runs.length || !runs.every((r) => (r.marks ?? []).some((m) => m.type === 'bold'))) return null
  return plainText(first).trim() || null
}

// The category title of a table cell: the first paragraph carrying a bold run
// (the user's category-name convention), else the first non-empty paragraph.
// With `upTo` (the cell child containing the target), the LAST bold paragraph
// at or before it wins — one cell can hold two sections (e.g. Apartment + Work).
function boldCategoryOfCell(cell: TiptapNode, upTo?: TiptapNode): string | null {
  const children = cell.content ?? []
  const stop = upTo ? children.indexOf(upTo) : -1
  if (stop !== -1) {
    for (let i = stop; i >= 0; i--) {
      const c = children[i]
      if (c.type === 'paragraph' && hasBoldRun(c)) {
        const text = plainText(c).trim()
        if (text) return text
      }
    }
  }

  const paras = children.filter((c) => c.type === 'paragraph')

  for (const p of paras) {
    if (hasBoldRun(p)) {
      const text = plainText(p).trim()
      if (text) return text
    }
  }

  for (const p of paras) {
    const text = plainText(p).trim()
    if (text) return text
  }

  return null
}

/**
 * Resolve the title of the section/category that the block `targetBlockId` lives
 * in, for use as the preview caption. Best-effort:
 *   - target IS a heading        -> its own text
 *   - target inside a table cell -> the cell's bold category name (or first line)
 *   - otherwise                  -> the nearest preceding heading (may be null)
 *
 * Returns null when the id is missing/unresolvable or nothing names the section.
 */
export function findSectionTitle(doc: TiptapNode, targetBlockId: string): string | null {
  return findPlacementPath(doc, targetBlockId).section
}

/**
 * Section AND category for the preview caption ("Running → Jerry Updates").
 * The category is the outermost bold list item enclosing the target (or the
 * target's own line, when it is a category line). Either part may be null.
 */
export function findPlacementPath(
  doc: TiptapNode,
  targetBlockId: string,
): { section: string | null; category: string | null } {
  if (!doc || typeof doc !== 'object' || !targetBlockId) return { section: null, category: null }

  let lastHeading: string | null = null
  let result: string | null = null
  let category: string | null = null
  let found = false

  const visit = (node: TiptapNode, ancestors: TiptapNode[]): void => {
    if (found) return

    // Track the most recent heading in document order (headings organize some docs).
    if (node.type === 'heading') {
      lastHeading = plainText(node).trim() || lastHeading
    }

    if (node.attrs?.id === targetBlockId) {
      found = true
      if (node.type === 'heading') {
        result = plainText(node).trim() || null
        return
      }
      // Outermost bold list item on the way down = the category.
      for (const a of ancestors) {
        const title = categoryTitleOfItem(a)
        if (title) {
          category = title
          break
        }
      }
      // Nearest enclosing table cell -> its section title (the single-column
      // category table is the common case).
      for (let i = ancestors.length - 1; i >= 0; i--) {
        const a = ancestors[i]
        if (a.type === 'tableCell' || a.type === 'tableHeader') {
          result = boldCategoryOfCell(a, ancestors[i + 1] ?? node)
          return
        }
      }
      // Heading-organized doc (no table): the most recent heading.
      result = lastHeading
      return
    }

    const childAncestors = [...ancestors, node]
    for (const child of node.content ?? []) {
      visit(child, childAncestors)
      if (found) return
    }
  }

  visit(doc, [])
  return { section: result, category }
}
