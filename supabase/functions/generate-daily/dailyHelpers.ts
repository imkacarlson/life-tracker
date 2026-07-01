export type DueBucket = 'overdue' | 'today' | 'soon' | 'later' | 'none'

export type InlineSegment = {
  text: string
  highlighted: boolean
}

// One advisory hint per line that contains a highlighted (due-style) date. The
// server no longer decides placement from these — the AI does — so a hint is
// purely informational: "this line has a date; here's how the deterministic
// pass reads it".
export type DateHint = {
  cid: string
  dateText: string
  parsedIso: string
  bucket: DueBucket
}

export type ParsedTaskBuckets = {
  asap: any[]
  fyi: any[]
  format: 'empty' | 'asap_fyi'
}

export type MappedTask = {
  task: string
  block_ids: string[]
  priority: string
}

export type TrackerContext = {
  markdown: string
  cidToBlockId: Map<string, string>
  cidToText: Map<string, string>
  dateHints: DateHint[]
}

const DAY_MS = 24 * 60 * 60 * 1000
const DATE_TOKEN_REGEX = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g
const WRITTEN_YEAR_REGEX = /\b(20\d\d)\b/

const toUtcDate = (value: string) => {
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const toIsoDate = (date: Date) => date.toISOString().slice(0, 10)

const normalizeText = (value: string) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

const parseDateToken = (
  monthValue: string,
  dayValue: string,
  yearValue: string | undefined,
  defaultYear: number,
) => {
  const month = Number(monthValue)
  const day = Number(dayValue)

  let year = defaultYear
  if (yearValue) {
    const parsedYear = Number(yearValue)
    if (!Number.isFinite(parsedYear)) return null
    year = yearValue.length === 2 ? 2000 + parsedYear : parsedYear
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return date
}

type DateToken = { date: Date; raw: string }

const extractDateTokens = (text: string, defaultYear: number): DateToken[] => {
  const results: DateToken[] = []
  const normalized = String(text || '')

  DATE_TOKEN_REGEX.lastIndex = 0
  let match: RegExpExecArray | null = DATE_TOKEN_REGEX.exec(normalized)
  while (match) {
    const date = parseDateToken(match[1], match[2], match[3], defaultYear)
    if (date) results.push({ date, raw: match[0] })
    match = DATE_TOKEN_REGEX.exec(normalized)
  }

  return results
}

const bucketForDate = (dueDate: Date, todayDate: Date): DueBucket => {
  const diffDays = Math.floor((dueDate.getTime() - todayDate.getTime()) / DAY_MS)
  if (diffDays < 0) return 'overdue'
  if (diffDays === 0) return 'today'
  if (diffDays <= 2) return 'soon'
  return 'later'
}

const appendSegment = (segments: InlineSegment[], segment: InlineSegment) => {
  if (!segment.text) return
  const previous = segments[segments.length - 1]
  if (previous && previous.highlighted === segment.highlighted) {
    previous.text += segment.text
    return
  }
  segments.push({ ...segment })
}

// Collect visible inline text as highlighted/plain runs. Struck-through
// (completed) text is dropped so finished items don't resurface as due dates.
const collectInlineSegments = (nodes: any[]): InlineSegment[] => {
  const segments: InlineSegment[] = []

  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return

    if (node.type === 'text') {
      const marks = Array.isArray(node.marks) ? node.marks : []
      if (marks.some((mark: any) => mark?.type === 'strike')) return

      appendSegment(segments, {
        text: String(node.text || ''),
        highlighted: marks.some((mark: any) => mark?.type === 'highlight'),
      })
      return
    }

    if (node.type === 'hardBreak') {
      appendSegment(segments, { text: '\n', highlighted: false })
      return
    }

    if (Array.isArray(node.content)) {
      node.content.forEach(walk)
    }
  }

  ;(nodes || []).forEach(walk)
  return segments
}

// ---------------------------------------------------------------------------
// Markdown serializer with per-line cid anchors
//
// Ported from src/lib/serializeDocForExport.js (pure/DOM-free) and extended so
// every block that carries an id gets a stable `⟦c12⟧` anchor appended to its
// line. The anchor's cid maps to that block's id (the deep-link target) and to
// its plain text, and the block's inline runs are captured for the date pass.
// ---------------------------------------------------------------------------

type SerializeCtx = {
  counter: { value: number }
  cidToBlockId: Map<string, string>
  cidToText: Map<string, string>
  cidSegments: Map<string, InlineSegment[]>
  suppressAnchors: boolean
}

function serializeInline(content: any[] | undefined): string {
  if (!content) return ''
  return content
    .map((node) => {
      if (node.type === 'text') {
        let text = node.text || ''
        const marks = node.marks || []
        const hasBold = marks.some((m: any) => m.type === 'bold')
        const hasItalic = marks.some((m: any) => m.type === 'italic')
        const hasStrike = marks.some((m: any) => m.type === 'strike')
        const hasHighlight = marks.some((m: any) => m.type === 'highlight')
        if (hasBold) text = `**${text}**`
        if (hasItalic) text = `_${text}_`
        if (hasStrike) text = `~~${text}~~`
        if (hasHighlight) text = `[${text}]`
        return text
      }
      if (node.type === 'hardBreak') return '\n'
      if (node.type === 'image') return '[image]'
      return ''
    })
    .join('')
}

// Register a cid for an id-bearing block and return the anchor suffix to append.
function registerAnchor(
  ctx: SerializeCtx,
  id: string | undefined | null,
  inlineContent: any[] | undefined,
): string {
  if (!id || ctx.suppressAnchors) return ''
  const cid = `c${ctx.counter.value}`
  ctx.counter.value += 1
  ctx.cidToBlockId.set(cid, id)
  const segments = collectInlineSegments(inlineContent || [])
  ctx.cidSegments.set(cid, segments)
  ctx.cidToText.set(cid, normalizeText(segments.map((s) => s.text).join('')))
  return ` ⟦${cid}⟧`
}

function serializeNode(
  node: any,
  lines: string[],
  ctx: SerializeCtx,
  indent = 0,
  listIndex: any = null,
) {
  const prefix = '  '.repeat(indent)

  switch (node.type) {
    case 'doc':
      node.content?.forEach((child: any) => serializeNode(child, lines, ctx, indent))
      break

    case 'paragraph': {
      const text = serializeInline(node.content)
      const anchor = registerAnchor(ctx, node.attrs?.id, node.content)
      lines.push(prefix + text + anchor)
      break
    }

    case 'heading': {
      const text = serializeInline(node.content)
      const anchor = registerAnchor(ctx, node.attrs?.id, node.content)
      if (lines.length > 0) lines.push('')
      lines.push(prefix + text.toUpperCase() + anchor)
      lines.push('')
      break
    }

    case 'bulletList':
      node.content?.forEach((child: any) => serializeNode(child, lines, ctx, indent, 'bullet'))
      break

    case 'orderedList': {
      let counter = 1
      node.content?.forEach((child: any) => {
        serializeNode(child, lines, ctx, indent, counter)
        counter += 1
      })
      break
    }

    case 'taskList':
      node.content?.forEach((child: any) => serializeNode(child, lines, ctx, indent, 'task'))
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
      children.forEach((child: any, i: number) => {
        if (i === 0 && child.type === 'paragraph') {
          // The item's first paragraph holds the deep-link id, so anchor here.
          const anchor = registerAnchor(ctx, child.attrs?.id, child.content)
          lines.push(prefix + marker + serializeInline(child.content) + anchor)
        } else {
          serializeNode(child, lines, ctx, indent + 1)
        }
      })
      break
    }

    case 'table': {
      const rows = node.content || []
      if (rows.length === 0) break

      const columnCount = rows[0]?.content?.length || 0

      if (columnCount === 1) {
        // Single-column table: preserve inner structure (and its anchors).
        rows.forEach((row: any, rowIdx: number) => {
          const cell = row.content?.[0]
          if (cell) {
            cell.content?.forEach((child: any) => serializeNode(child, lines, ctx, indent))
          }
          if (rowIdx < rows.length - 1) {
            lines.push('')
            lines.push(prefix + '---')
            lines.push('')
          }
        })
      } else {
        // Multi-column table: flatten to pipe rows. Anchoring individual cells
        // inside a joined row would be noise, so suppress anchors here.
        const previousSuppress = ctx.suppressAnchors
        ctx.suppressAnchors = true
        rows.forEach((row: any, rowIdx: number) => {
          const cells = (row.content || []).map((cell: any) => {
            const cellLines: string[] = []
            cell.content?.forEach((child: any) => serializeNode(child, cellLines, ctx, 0))
            return cellLines.join(' ').trim()
          })
          lines.push(prefix + '| ' + cells.join(' | ') + ' |')
          if (rowIdx === 0) {
            const separator = cells.map((c: string) => '-'.repeat(Math.max(c.length, 3))).join(' | ')
            lines.push(prefix + '| ' + separator + ' |')
          }
        })
        ctx.suppressAnchors = previousSuppress
      }
      break
    }

    case 'tableRow':
    case 'tableCell':
    case 'tableHeader':
      node.content?.forEach((child: any) => serializeNode(child, lines, ctx, indent))
      break

    case 'blockquote':
      node.content?.forEach((child: any) => serializeNode(child, lines, ctx, indent + 1))
      break

    case 'codeBlock': {
      lines.push(prefix + '```')
      const text = node.content?.map((n: any) => n.text || '').join('') || ''
      text.split('\n').forEach((line: string) => lines.push(prefix + line))
      lines.push(prefix + '```')
      break
    }

    case 'horizontalRule':
      lines.push(prefix + '---')
      break

    default:
      if (node.content) {
        node.content.forEach((child: any) => serializeNode(child, lines, ctx, indent))
      }
      break
  }
}

const createCtx = (counter: { value: number }): SerializeCtx => ({
  counter,
  cidToBlockId: new Map<string, string>(),
  cidToText: new Map<string, string>(),
  cidSegments: new Map<string, InlineSegment[]>(),
  suppressAnchors: false,
})

type SerializeResult = {
  markdown: string
  cidToBlockId: Map<string, string>
  cidToText: Map<string, string>
  cidSegments: Map<string, InlineSegment[]>
}

const serializeContentWithCtx = (content: any, ctx: SerializeCtx, title?: string): string => {
  const lines: string[] = []
  if (title) {
    lines.push(normalizeText(title).toUpperCase())
    lines.push('')
  }
  if (content && typeof content === 'object') {
    serializeNode(content, lines, ctx)
  }
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

// Serialize a single tracker doc to markdown, assigning a cid anchor to every
// id-bearing block.
export const serializeTrackerToMarkdown = (content: any, title?: string): SerializeResult => {
  const ctx = createCtx({ value: 1 })
  const markdown = serializeContentWithCtx(content, ctx, title)
  return {
    markdown,
    cidToBlockId: ctx.cidToBlockId,
    cidToText: ctx.cidToText,
    cidSegments: ctx.cidSegments,
  }
}

// Build one advisory hint per line that contains a highlighted date. Year
// inference: when a highlighted date has no slash-year, a written year on the
// same line (e.g. "(of 2027)") is used as the default; an explicit slash-year
// always wins.
export const buildDateHints = (
  cidSegments: Map<string, InlineSegment[]>,
  today: string,
): DateHint[] => {
  const todayDate = toUtcDate(today)
  if (!todayDate) return []

  const hints: DateHint[] = []

  for (const [cid, segments] of cidSegments) {
    const fullText = segments.map((s) => s.text).join('')
    const writtenYearMatch = fullText.match(WRITTEN_YEAR_REGEX)
    const defaultYear = writtenYearMatch
      ? Number(writtenYearMatch[1])
      : todayDate.getUTCFullYear()

    const highlightedTokens = segments
      .filter((segment) => segment.highlighted)
      .flatMap((segment) => extractDateTokens(segment.text, defaultYear))

    if (!highlightedTokens.length) continue

    const earliest = highlightedTokens
      .slice()
      .sort((a, b) => a.date.getTime() - b.date.getTime())[0]

    hints.push({
      cid,
      dateText: earliest.raw,
      parsedIso: toIsoDate(earliest.date),
      bucket: bucketForDate(earliest.date, todayDate),
    })
  }

  return hints
}

// Build the full context sent to the model: whole-tracker markdown, the cid ->
// block/text maps for mapping the response back, and the advisory date hints.
export const buildTrackerContext = (trackerPages: any[], today: string): TrackerContext => {
  const counter = { value: 1 }
  const cidToBlockId = new Map<string, string>()
  const cidToText = new Map<string, string>()
  const cidSegments = new Map<string, InlineSegment[]>()
  const sections: string[] = []

  for (const page of trackerPages || []) {
    const ctx = createCtx(counter)
    // Share the accumulating maps so cids stay globally unique across pages.
    ctx.cidToBlockId = cidToBlockId
    ctx.cidToText = cidToText
    ctx.cidSegments = cidSegments
    const markdown = serializeContentWithCtx(page?.content, ctx, page?.title)
    if (markdown) sections.push(markdown)
  }

  return {
    markdown: sections.join('\n\n'),
    cidToBlockId,
    cidToText,
    dateHints: buildDateHints(cidSegments, today),
  }
}

export const parseTaskBuckets = (text: string): ParsedTaskBuckets => {
  let asap: any[] = []
  let fyi: any[] = []
  let format: ParsedTaskBuckets['format'] = 'empty'

  try {
    const trimmed = String(text || '').trim()
    let parsed: any = null

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      parsed = JSON.parse(trimmed)
    } else {
      const objStart = trimmed.indexOf('{')
      const objEnd = trimmed.lastIndexOf('}')
      const arrStart = trimmed.indexOf('[')
      const arrEnd = trimmed.lastIndexOf(']')
      if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
        parsed = JSON.parse(trimmed.slice(objStart, objEnd + 1))
      } else if (arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart) {
        parsed = JSON.parse(trimmed.slice(arrStart, arrEnd + 1))
      }
    }

    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.asap)) asap = parsed.asap
      if (Array.isArray(parsed.fyi)) fyi = parsed.fyi

      if (Array.isArray(parsed.asap) || Array.isArray(parsed.fyi)) {
        format = 'asap_fyi'
      }
    }
  } catch {
    asap = []
    fyi = []
    format = 'empty'
  }

  return { asap, fyi, format }
}

const mapBucket = (
  tasks: any[],
  cidToBlockId: Map<string, string>,
  cidToText: Map<string, string>,
): { tasks: MappedTask[]; dropped: number } => {
  const mapped: MappedTask[] = []
  let dropped = 0

  for (const task of tasks || []) {
    if (!Array.isArray(task?.cids)) continue

    const cids: string[] = []
    for (const cid of task.cids) {
      if (cidToBlockId.has(cid)) {
        if (!cids.includes(cid)) cids.push(cid)
      } else {
        dropped += 1
      }
    }

    const blockIds = cids
      .map((cid) => cidToBlockId.get(cid))
      .filter((id): id is string => Boolean(id))
    if (!blockIds.length) continue

    const fallbackTaskText = cids
      .map((cid) => cidToText.get(cid))
      .filter((value): value is string => Boolean(value))
      .join(' + ')

    const taskText = String(task?.task || '').trim() || fallbackTaskText
    if (!taskText) continue

    const priority = ['high', 'medium', 'low'].includes(task?.priority)
      ? task.priority
      : 'medium'

    mapped.push({ task: taskText, block_ids: blockIds, priority })
  }

  return { tasks: mapped, dropped }
}

// Honor the AI's ASAP/FYI placement. The AI is the final judge now, so we keep
// whichever bucket it chose, resolve cids to block ids for cross-off linking,
// and silently drop cids the AI invented or that don't exist.
export const mapTasksByBucket = (
  parsed: ParsedTaskBuckets,
  cidToBlockId: Map<string, string>,
  cidToText: Map<string, string>,
): { asap: MappedTask[]; fyi: MappedTask[]; droppedUnknownCids: number } => {
  const asapResult = mapBucket(parsed.asap, cidToBlockId, cidToText)
  const fyiResult = mapBucket(parsed.fyi, cidToBlockId, cidToText)

  return {
    asap: asapResult.tasks,
    fyi: fyiResult.tasks,
    droppedUnknownCids: asapResult.dropped + fyiResult.dropped,
  }
}
