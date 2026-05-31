// Pure helpers (no Deno / jsr imports) so they can be unit-tested with Vitest.
//
// Adapted from src/lib/serializeDocForExport.js. The export serializer already
// flattens a Tiptap document to readable text and — importantly for the bot —
// preserves strikethrough as ~~text~~. Here we keep that behavior and add two
// bot-specific annotations that the export version does not emit:
//   1. highlight color   -> [text]{highlight:#fff2a8}
//   2. table cell shading -> "(cell shaded #c6efce) ..."
//
// Unlike the AI-Daily flattener (dailyHelpers.ts), this one NEVER drops
// crossed-off / completed items: the bot answers questions about them too.

import { formatNowInZone } from './datetime.ts'

type TiptapNode = {
  type?: string
  text?: string
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
}

type TrackerPage = {
  id?: string
  title?: string
  content?: TiptapNode | null
  is_tracker_page?: boolean
  updated_at?: string
}

// --- inline marks ---

function serializeInline(content: TiptapNode[] | undefined): string {
  if (!content) return ''
  return content
    .map((node) => {
      if (node.type === 'text') {
        let text = node.text || ''
        const marks = node.marks || []
        const hasBold = marks.some((m) => m.type === 'bold')
        const hasItalic = marks.some((m) => m.type === 'italic')
        const hasStrike = marks.some((m) => m.type === 'strike')
        const highlight = marks.find((m) => m.type === 'highlight')
        const link = marks.find((m) => m.type === 'link')

        if (hasBold) text = `**${text}**`
        if (hasItalic) text = `_${text}_`
        if (hasStrike) text = `~~${text}~~`
        if (highlight) {
          const color = highlight.attrs?.color
          text = color ? `[${text}]{highlight:${color}}` : `[${text}]`
        }
        if (link) {
          const href = link.attrs?.href
          if (href) text = `${text} (${href})`
        }
        return text
      }
      if (node.type === 'hardBreak') return '\n'
      if (node.type === 'image') return '[image]'
      return ''
    })
    .join('')
}

// --- block nodes ---

function cellShadingPrefix(node: TiptapNode): string {
  const bg = node.attrs?.backgroundColor
  return bg ? `(cell shaded ${bg}) ` : ''
}

function serializeNode(
  node: TiptapNode,
  lines: string[],
  indent = 0,
  listIndex: number | 'bullet' | 'task' | null = null,
): void {
  const prefix = '  '.repeat(indent)

  switch (node.type) {
    case 'doc':
      node.content?.forEach((child) => serializeNode(child, lines, indent))
      break

    case 'paragraph': {
      lines.push(prefix + serializeInline(node.content))
      break
    }

    case 'heading': {
      const text = serializeInline(node.content)
      if (lines.length > 0) lines.push('')
      lines.push(prefix + text.toUpperCase())
      lines.push('')
      break
    }

    case 'bulletList':
      node.content?.forEach((child) => serializeNode(child, lines, indent, 'bullet'))
      break

    case 'orderedList': {
      let counter = 1
      node.content?.forEach((child) => {
        serializeNode(child, lines, indent, counter)
        counter += 1
      })
      break
    }

    case 'taskList':
      node.content?.forEach((child) => serializeNode(child, lines, indent, 'task'))
      break

    case 'listItem':
    case 'taskItem': {
      const marker =
        listIndex === 'bullet'
          ? '- '
          : listIndex === 'task'
            ? node.attrs?.checked
              ? '[x] '
              : '[ ] '
            : `${listIndex}. `
      const children = node.content || []
      children.forEach((child, i) => {
        if (i === 0 && child.type === 'paragraph') {
          lines.push(prefix + marker + serializeInline(child.content))
        } else {
          serializeNode(child, lines, indent + 1)
        }
      })
      break
    }

    case 'table': {
      const rows = node.content || []
      if (rows.length === 0) break

      const columnCount = rows[0]?.content?.length || 0

      if (columnCount === 1) {
        // Single-column table: keep structure with --- separators.
        rows.forEach((row, rowIdx) => {
          const cell = row.content?.[0]
          if (cell) {
            const shading = cellShadingPrefix(cell)
            if (shading) lines.push(prefix + shading.trim())
            cell.content?.forEach((child) => serializeNode(child, lines, indent))
          }
          if (rowIdx < rows.length - 1) {
            lines.push('')
            lines.push(prefix + '---')
            lines.push('')
          }
        })
      } else {
        // Multi-column table: pipe format. First column is usually the category.
        rows.forEach((row, rowIdx) => {
          const cells = (row.content || []).map((cell) => {
            const cellLines: string[] = []
            cell.content?.forEach((child) => serializeNode(child, cellLines, 0))
            const body = cellLines.join(' ').trim()
            return cellShadingPrefix(cell) + body
          })
          lines.push(prefix + '| ' + cells.join(' | ') + ' |')
          if (rowIdx === 0) {
            const separator = cells.map((c) => '-'.repeat(Math.max(c.length, 3))).join(' | ')
            lines.push(prefix + '| ' + separator + ' |')
          }
        })
      }
      break
    }

    case 'tableRow':
    case 'tableCell':
    case 'tableHeader':
      node.content?.forEach((child) => serializeNode(child, lines, indent))
      break

    case 'blockquote':
      node.content?.forEach((child) => serializeNode(child, lines, indent + 1))
      break

    case 'codeBlock': {
      lines.push(prefix + '```')
      const text = node.content?.map((n) => n.text || '').join('') || ''
      text.split('\n').forEach((line) => lines.push(prefix + line))
      lines.push(prefix + '```')
      break
    }

    case 'horizontalRule':
      lines.push(prefix + '---')
      break

    default:
      if (node.content) {
        node.content.forEach((child) => serializeNode(child, lines, indent))
      }
      break
  }
}

/**
 * Flatten a tracker page's Tiptap JSON content into readable text for the LLM.
 * Crossed-off items are preserved; highlight colors and cell shading are annotated.
 */
export function flattenTrackerToText(content: TiptapNode | null | undefined, title?: string): string {
  if (!content || typeof content !== 'object') return ''

  const lines: string[] = []
  if (title) {
    lines.push(title.trim().toUpperCase())
    lines.push('')
  }
  serializeNode(content, lines)

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

/**
 * Pick the tracker page for the current month.
 *
 * Strategy: among pages with is_tracker_page === true, prefer the one whose
 * title contains the current month name AND year (e.g. "May 2026 Tracker").
 * Fall back to the most-recently-updated tracker page.
 *
 * The month/year are derived in `timeZone` (the user's local zone) rather than
 * the server's UTC clock, so near month boundaries / late at night the bot still
 * picks the page for the user's local month. Defaults to 'UTC'.
 */
export function selectCurrentMonthTracker(
  pages: TrackerPage[] | null | undefined,
  now: Date,
  timeZone = 'UTC',
): TrackerPage | null {
  const trackerPages = (pages || []).filter((p) => p.is_tracker_page)
  if (trackerPages.length === 0) return null

  const { monthName, year } = formatNowInZone(now, timeZone)
  const month = monthName.toLowerCase()

  const monthMatch = trackerPages.find((p) => {
    const title = (p.title || '').toLowerCase()
    return title.includes(month) && title.includes(year)
  })
  if (monthMatch) return monthMatch

  // Fallback: most recently updated tracker page.
  return trackerPages
    .slice()
    .sort((a, b) => {
      const ta = a.updated_at ? Date.parse(a.updated_at) : 0
      const tb = b.updated_at ? Date.parse(b.updated_at) : 0
      return tb - ta
    })[0]
}
