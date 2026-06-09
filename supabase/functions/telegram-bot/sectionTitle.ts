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

// The category title of a table cell: the first paragraph carrying a bold run
// (the user's category-name convention), else the first non-empty paragraph.
function boldCategoryOfCell(cell: TiptapNode): string | null {
  const paras = (cell.content ?? []).filter((c) => c.type === 'paragraph')

  for (const p of paras) {
    const hasBold = (p.content ?? []).some(
      (run) => run.type === 'text' && (run.marks ?? []).some((m) => m.type === 'bold'),
    )
    if (hasBold) {
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
  if (!doc || typeof doc !== 'object' || !targetBlockId) return null

  let lastHeading: string | null = null
  let result: string | null = null
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
      // Nearest enclosing table cell -> its category title (the single-column
      // category table is the common case).
      for (let i = ancestors.length - 1; i >= 0; i--) {
        const a = ancestors[i]
        if (a.type === 'tableCell' || a.type === 'tableHeader') {
          result = boldCategoryOfCell(a)
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
  return result
}
