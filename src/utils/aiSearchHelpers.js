// Pure helpers for AI-assisted "find". These take plain Tiptap JSON or a real
// ProseMirror doc and return plain data — no DOM, no editor view — so they're
// unit-testable with Vitest. See src/utils/__tests__/aiSearchHelpers.test.js.

// Block-level node types that carry their own stable `attrs.id` (set by the
// EnsureNodeIds extension) and hold user-visible text we want to search over.
const TEXT_BEARING_TYPES = new Set(['paragraph', 'heading'])

/**
 * Collect the visible text of a single Tiptap JSON node (recursively).
 * @param {object} node
 * @returns {string}
 */
function collectNodeText(node) {
  if (!node || typeof node !== 'object') return ''
  if (node.type === 'text') return typeof node.text === 'string' ? node.text : ''
  if (!Array.isArray(node.content)) return ''
  return node.content.map(collectNodeText).join('')
}

/**
 * Walk Tiptap JSON and return one `{ id, text }` entry per text-bearing block
 * (paragraphs/headings, including those nested inside list items and table
 * cells). Blocks without an id or with only whitespace are skipped.
 *
 * @param {object} docJson - Tiptap document JSON (editor.getJSON()).
 * @returns {{ id: string, text: string }[]}
 */
export function extractSearchableBlocks(docJson) {
  const blocks = []
  const seen = new Set()

  const walk = (node) => {
    if (!node || typeof node !== 'object') return

    if (TEXT_BEARING_TYPES.has(node.type)) {
      const id = node.attrs?.id
      const text = collectNodeText(node).trim()
      if (id && text && !seen.has(id)) {
        seen.add(id)
        blocks.push({ id, text })
      }
      // Paragraphs/headings only hold inline content, so no need to recurse
      // for more blocks — but cells/list items are handled by the branch below.
      return
    }

    if (Array.isArray(node.content)) {
      node.content.forEach(walk)
    }
  }

  walk(docJson)
  return blocks
}

/**
 * Given a real ProseMirror `doc` and a set/array of matching block ids, return
 * `[{ from, to }]` whole-node ranges for each node whose `attrs.id` is in the
 * set. Ranges are sorted by `from`.
 *
 * @param {import('@tiptap/pm/model').Node} doc
 * @param {Iterable<string>} matchIds
 * @returns {{ from: number, to: number }[]}
 */
export function resolveBlockRanges(doc, matchIds) {
  const ids = matchIds instanceof Set ? matchIds : new Set(matchIds || [])
  if (!doc || ids.size === 0) return []

  const ranges = []
  doc.descendants((node, pos) => {
    const id = node.attrs?.id
    if (id && ids.has(id)) {
      ranges.push({ from: pos, to: pos + node.nodeSize })
    }
    return true
  })

  ranges.sort((a, b) => a.from - b.from)
  return ranges
}

/**
 * Stable client-cache key for an AI find result. Combines a document version
 * (or any change token) with the normalized query so re-typing the same query
 * against unchanged content is a cache hit.
 *
 * @param {string|number} docVersion
 * @param {string} query
 * @returns {string}
 */
export function buildSearchCacheKey(docVersion, query) {
  const normalizedQuery = String(query || '').trim().toLowerCase()
  return `${String(docVersion ?? '')}::${normalizedQuery}`
}
