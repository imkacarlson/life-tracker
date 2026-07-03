export type DueBucket = 'overdue' | 'today' | 'soon' | 'later' | 'none'

export type InlineSegment = {
  text: string
  highlighted: boolean
}

// One deterministic candidate per line that carries a highlighted MM/DD token.
// The deterministic pass is the judge of what makes the list; a candidate holds
// everything that decision needs. `needsAiYear` is true only when the year came
// from the current-year default (no slash-year, no written 20xx on the line),
// so the AI is asked to resolve a plain-language year for just those lines.
export type DateCandidate = {
  cid: string
  dateText: string
  month: number
  day: number
  deterministicIso: string
  needsAiYear: boolean
}

// The AI's strictly-additive enrichment output: per-candidate year resolution +
// phrasing, and flags for highlighted lines whose date the regex couldn't read.
export type DateResolutions = {
  resolutions: Map<string, { iso_date: string | null; task: string }>
  flagged: Array<{ cid: string; iso_date: string; task: string }>
  format: 'resolved' | 'empty'
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
  candidates: DateCandidate[]
  highlightedCids: Set<string>
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

type DateToken = {
  date: Date
  raw: string
  month: number
  day: number
  hasSlashYear: boolean
}

const extractDateTokens = (text: string, defaultYear: number): DateToken[] => {
  const results: DateToken[] = []
  const normalized = String(text || '')

  DATE_TOKEN_REGEX.lastIndex = 0
  let match: RegExpExecArray | null = DATE_TOKEN_REGEX.exec(normalized)
  while (match) {
    const date = parseDateToken(match[1], match[2], match[3], defaultYear)
    if (date) {
      results.push({
        date,
        raw: match[0],
        month: Number(match[1]),
        day: Number(match[2]),
        hasSlashYear: Boolean(match[3]),
      })
    }
    match = DATE_TOKEN_REGEX.exec(normalized)
  }

  return results
}

// Validate that a value is a real MM/DD calendar date in a 20xx year written as
// an ISO string. Returns the parsed UTC date and its year, or null. Guards
// against JS date rollover (e.g. "2027-02-30") by round-tripping the ISO string.
const VALID_ISO_REGEX = /^(20\d\d)-\d\d-\d\d$/

const parseValidIso = (value: unknown): { date: Date; year: number } | null => {
  if (typeof value !== 'string') return null
  const match = value.match(VALID_ISO_REGEX)
  if (!match) return null
  const date = toUtcDate(value)
  if (!date || toIsoDate(date) !== value) return null
  return { date, year: Number(match[1]) }
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

// Build one deterministic candidate per line that carries a highlighted MM/DD
// token. Year ladder: an explicit slash-year wins; else a written 20xx year on
// the same line (e.g. "(of 2027)") is used; else the current year is the
// default. `needsAiYear` is set only in that last case — the one time a
// plain-language year could change the result — so the AI never touches
// month/day, only the year for those lines.
export const buildCandidates = (
  cidSegments: Map<string, InlineSegment[]>,
  today: string,
): DateCandidate[] => {
  const todayDate = toUtcDate(today)
  if (!todayDate) return []

  const candidates: DateCandidate[] = []

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

    candidates.push({
      cid,
      dateText: earliest.raw,
      month: earliest.month,
      day: earliest.day,
      deterministicIso: toIsoDate(earliest.date),
      needsAiYear: !earliest.hasSlashYear && !writtenYearMatch,
    })
  }

  return candidates
}

// The user's convention: a highlight marks a due date. This is the server-side
// gate for the AI's additive flagging — a flagged line is only accepted if its
// cid carries a highlight here.
export const buildHighlightedCids = (
  cidSegments: Map<string, InlineSegment[]>,
): Set<string> => {
  const highlighted = new Set<string>()
  for (const [cid, segments] of cidSegments) {
    if (segments.some((segment) => segment.highlighted && segment.text.trim())) {
      highlighted.add(cid)
    }
  }
  return highlighted
}

// Step 4 precedence for a candidate's final date:
//   1. explicit/digit year (needsAiYear false)  → deterministic date wins.
//   2. plain-language year the AI resolved       → recombine its YEAR ONLY with
//      the deterministic month/day (re-validated), else fall back.
//   3. no valid AI year                          → current-year default stands.
export const resolveFinalDate = (
  candidate: DateCandidate,
  aiIso: unknown,
  today: string,
): Date => {
  const deterministic = toUtcDate(candidate.deterministicIso) as Date

  if (!candidate.needsAiYear) return deterministic

  const parsed = parseValidIso(aiIso)
  if (parsed) {
    const todayDate = toUtcDate(today)
    const currentYear = todayDate ? todayDate.getUTCFullYear() : parsed.year
    const recombined = parseDateToken(
      String(candidate.month),
      String(candidate.day),
      String(parsed.year),
      currentYear,
    )
    if (recombined) return recombined
  }

  return deterministic
}

// A flagged line has no deterministic month/day (the regex missed it), so the
// AI's full ISO date is used — but only if it parses as a real 20xx date.
export const resolveFlaggedDate = (aiIso: unknown, _today: string): Date | null => {
  const parsed = parseValidIso(aiIso)
  return parsed ? parsed.date : null
}

// Build the full context sent to the model: whole-tracker markdown, the cid ->
// block/text maps for mapping the response back, the deterministic date
// candidates (which decide the list), and the set of highlighted cids (the
// server-side gate for the AI's additive flagging).
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
    candidates: buildCandidates(cidSegments, today),
    highlightedCids: buildHighlightedCids(cidSegments),
  }
}

// Tolerantly parse the AI's structured-extraction JSON. The model is asked to
// return ONLY `{ resolutions: [...], flagged: [...] }`, but may fence or pad it,
// so we slice to the first top-level `{...}` object. Entries missing a string
// `cid` are ignored; flagged entries require a string `iso_date`. `format` is
// 'resolved' whenever the object parsed (even if empty), so the deterministic
// list stands without a spurious warning.
export const parseDateResolutions = (text: string): DateResolutions => {
  const resolutions = new Map<string, { iso_date: string | null; task: string }>()
  const flagged: Array<{ cid: string; iso_date: string; task: string }> = []
  let format: DateResolutions['format'] = 'empty'

  try {
    const trimmed = String(text || '').trim()
    let parsed: any = null

    if (trimmed.startsWith('{')) {
      parsed = JSON.parse(trimmed)
    } else {
      const objStart = trimmed.indexOf('{')
      const objEnd = trimmed.lastIndexOf('}')
      if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
        parsed = JSON.parse(trimmed.slice(objStart, objEnd + 1))
      }
    }

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      format = 'resolved'

      if (Array.isArray(parsed.resolutions)) {
        for (const entry of parsed.resolutions) {
          if (!entry || typeof entry.cid !== 'string') continue
          const iso = typeof entry.iso_date === 'string' ? entry.iso_date : null
          const task = typeof entry.task === 'string' ? entry.task : ''
          resolutions.set(entry.cid, { iso_date: iso, task })
        }
      }

      if (Array.isArray(parsed.flagged)) {
        for (const entry of parsed.flagged) {
          if (!entry || typeof entry.cid !== 'string') continue
          if (typeof entry.iso_date !== 'string') continue
          const task = typeof entry.task === 'string' ? entry.task : ''
          flagged.push({ cid: entry.cid, iso_date: entry.iso_date, task })
        }
      }
    }
  } catch {
    resolutions.clear()
    flagged.length = 0
    format = 'empty'
  }

  return { resolutions, flagged, format }
}

// Build today's list. The deterministic candidates decide inclusion (the AI can
// never remove, move, or re-bucket one); the AI only supplies a resolved year
// and phrasing. Flagged extras are merged strictly additively, each gated by
// (a) highlighted, (b) not already a candidate, (c) a valid, parseable date.
// bucketForDate still decides inclusion for flagged items too.
export const buildDaily = (
  candidates: DateCandidate[],
  parsed: DateResolutions,
  cidToBlockId: Map<string, string>,
  cidToText: Map<string, string>,
  highlightedCids: Set<string>,
  today: string,
): { asap: MappedTask[]; fyi: MappedTask[]; feedback: string[] } => {
  const asap: MappedTask[] = []
  const fyi: MappedTask[] = []
  const feedback: string[] = []

  const todayDate = toUtcDate(today)
  if (!todayDate) return { asap, fyi, feedback }

  const candidateCids = new Set(candidates.map((candidate) => candidate.cid))

  const place = (bucket: DueBucket, task: string, blockId: string) => {
    const isAsap = bucket === 'overdue' || bucket === 'today'
    const entry: MappedTask = {
      task,
      block_ids: [blockId],
      priority: isAsap ? 'high' : 'medium',
    }
    if (isAsap) asap.push(entry)
    else fyi.push(entry)
  }

  // Candidates first — authoritative. Order follows tracker order.
  for (const candidate of candidates) {
    const blockId = cidToBlockId.get(candidate.cid)
    if (!blockId) continue

    const resolution = parsed.resolutions.get(candidate.cid)
    const finalDate = resolveFinalDate(candidate, resolution?.iso_date ?? null, today)
    const bucket = bucketForDate(finalDate, todayDate)
    if (bucket !== 'overdue' && bucket !== 'today' && bucket !== 'soon') continue

    const task = (resolution?.task?.trim() || cidToText.get(candidate.cid) || '').trim()
    if (!task) continue

    place(bucket, task, blockId)
  }

  // Flagged extras — additive only. Never override a candidate cid.
  for (const entry of parsed.flagged) {
    const { cid } = entry
    if (!highlightedCids.has(cid)) continue
    if (candidateCids.has(cid)) continue

    const blockId = cidToBlockId.get(cid)
    if (!blockId) continue

    const flaggedDate = resolveFlaggedDate(entry.iso_date, today)
    if (!flaggedDate) continue

    const bucket = bucketForDate(flaggedDate, todayDate)
    if (bucket !== 'overdue' && bucket !== 'today' && bucket !== 'soon') continue

    const task = (entry.task?.trim() || cidToText.get(cid) || '').trim()
    if (!task) continue

    place(bucket, task, blockId)
    feedback.push(`Added from a highlighted date the parser couldn't read: "${task}"`)
  }

  return { asap, fyi, feedback }
}
