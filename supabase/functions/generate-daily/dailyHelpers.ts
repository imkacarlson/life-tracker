export type DueBucket = 'overdue' | 'today' | 'soon' | 'later' | 'none'

export type NextStepItem = {
  text: string
  blockId: string
  dueBucket: DueBucket
  isOverdue: boolean
  hasExplicitDate: boolean
}

export type CandidateForModel = {
  cid: string
  text: string
  due_bucket: DueBucket
  is_overdue: boolean
  has_explicit_date: boolean
}

export type ParsedTaskBuckets = {
  asap: any[]
  fyi: any[]
  format: 'empty' | 'asap_fyi'
}

type InlineSegment = {
  text: string
  highlighted: boolean
}

type DueMetadata = {
  dueBucket: DueBucket
  isOverdue: boolean
  hasExplicitDate: boolean
  hasAnyDateText: boolean
}

type FlattenedBlock = {
  kind: 'text' | 'list' | 'divider'
  nodeType?: string
  text?: string
  inlineContent?: any[]
  paragraphAttrs?: Record<string, any>
  itemAttrs?: Record<string, any>
}

const DAY_MS = 24 * 60 * 60 * 1000
const DATE_TOKEN_REGEX = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g

const toUtcDate = (value: string) => {
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const normalizeText = (value: string) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

const parseDateToken = (monthValue: string, dayValue: string, yearValue: string | undefined, defaultYear: number) => {
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

const parseDatesFromText = (text: string, defaultYear: number) => {
  const results: Date[] = []
  const normalized = String(text || '')

  DATE_TOKEN_REGEX.lastIndex = 0
  let match: RegExpExecArray | null = DATE_TOKEN_REGEX.exec(normalized)
  while (match) {
    const date = parseDateToken(match[1], match[2], match[3], defaultYear)
    if (date) results.push(date)
    match = DATE_TOKEN_REGEX.exec(normalized)
  }

  return results
}

const buildDueMetadata = (highlightedDates: Date[], hasAnyDateText: boolean, todayDate: Date): DueMetadata => {
  if (!highlightedDates.length) {
    return {
      dueBucket: 'none',
      isOverdue: false,
      hasExplicitDate: false,
      hasAnyDateText,
    }
  }

  const earliestDueDate = highlightedDates
    .slice()
    .sort((a, b) => a.getTime() - b.getTime())[0]

  const diffDays = Math.floor((earliestDueDate.getTime() - todayDate.getTime()) / DAY_MS)
  if (diffDays < 0) {
    return {
      dueBucket: 'overdue',
      isOverdue: true,
      hasExplicitDate: true,
      hasAnyDateText,
    }
  }

  if (diffDays === 0) {
    return {
      dueBucket: 'today',
      isOverdue: false,
      hasExplicitDate: true,
      hasAnyDateText,
    }
  }

  if (diffDays <= 2) {
    return {
      dueBucket: 'soon',
      isOverdue: false,
      hasExplicitDate: true,
      hasAnyDateText,
    }
  }

  return {
    dueBucket: 'later',
    isOverdue: false,
    hasExplicitDate: true,
    hasAnyDateText,
  }
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

const collectInlineSegments = (nodes: any[]): InlineSegment[] => {
  const segments: InlineSegment[] = []

  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return

    if (node.type === 'text') {
      const marks = Array.isArray(node.marks) ? node.marks : []
      if (marks.some((mark) => mark?.type === 'strike')) return

      appendSegment(segments, {
        text: String(node.text || ''),
        highlighted: marks.some((mark) => mark?.type === 'highlight'),
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

const flattenBlocks = (node: any, into: FlattenedBlock[]) => {
  if (!node || typeof node !== 'object') return

  if (node.type === 'horizontalRule') {
    into.push({ kind: 'divider' })
    return
  }

  if (node.type === 'paragraph' || node.type === 'heading') {
    const segments = collectInlineSegments(node.content || [])
    into.push({
      kind: 'text',
      nodeType: node.type,
      text: normalizeText(segments.map((segment) => segment.text).join('')),
      inlineContent: node.content || [],
      paragraphAttrs: node.attrs || {},
    })
    return
  }

  if (node.type === 'listItem' || node.type === 'taskItem') {
    const firstParagraph = (node.content || []).find((child: any) => child?.type === 'paragraph')
    const inlineContent = firstParagraph?.content || []
    const segments = collectInlineSegments(inlineContent)

    into.push({
      kind: 'list',
      nodeType: node.type,
      text: normalizeText(segments.map((segment) => segment.text).join('')),
      inlineContent,
      paragraphAttrs: firstParagraph?.attrs || {},
      itemAttrs: node.attrs || {},
    })

    ;(node.content || []).forEach((child: any) => {
      if (child === firstParagraph) return
      flattenBlocks(child, into)
    })
    return
  }

  if (Array.isArray(node.content)) {
    node.content.forEach((child: any) => flattenBlocks(child, into))
  }
}

const isNextStepsHeader = (text: string) =>
  /^next steps\b(?:\s*(?:[:\-].*|\(.*\)))?$/i.test(normalizeText(text))

const isSectionBoundary = (block: FlattenedBlock) => {
  if (block.kind !== 'text') return false

  const text = normalizeText(block.text || '')
  if (!text) return false

  if (block.nodeType === 'heading') {
    return !isNextStepsHeader(text)
  }

  const isGenericSectionLabel = /^[A-Za-z0-9][A-Za-z0-9\s/&'()\-]{0,80}:\s*$/.test(text)
  if (isGenericSectionLabel && !isNextStepsHeader(text)) {
    return true
  }

  return /^(background|recurring(?:\s+things?)?|notes?)\s*:?\s*$/i.test(text)
}

const getDueMetadataFromInline = (inlineContent: any[], todayDate: Date): DueMetadata => {
  const segments = collectInlineSegments(inlineContent || [])
  const text = segments.map((segment) => segment.text).join('')

  const allDates = parseDatesFromText(text, todayDate.getUTCFullYear())
  const highlightedDates = segments
    .filter((segment) => segment.highlighted)
    .flatMap((segment) => parseDatesFromText(segment.text, todayDate.getUTCFullYear()))

  return buildDueMetadata(highlightedDates, allDates.length > 0, todayDate)
}

const extractNextStepsFromContent = (content: any, today: string): NextStepItem[] => {
  const todayDate = toUtcDate(today)
  if (!todayDate || !content || typeof content !== 'object') return []

  const blocks: FlattenedBlock[] = []
  flattenBlocks(content, blocks)

  const nextSteps: NextStepItem[] = []
  let inNextSteps = false

  for (const block of blocks) {
    if (block.kind === 'divider') {
      inNextSteps = false
      continue
    }

    if (block.kind === 'text') {
      const text = normalizeText(block.text || '')
      if (isNextStepsHeader(text)) {
        inNextSteps = true
        continue
      }

      if (inNextSteps && isSectionBoundary(block)) {
        inNextSteps = false
      }
      continue
    }

    if (!inNextSteps) {
      continue
    }

    if (block.itemAttrs?.checked) {
      continue
    }

    const text = normalizeText(block.text || '')
    if (!text) continue

    const dueMeta = getDueMetadataFromInline(block.inlineContent || [], todayDate)

    // Workflow rule: unhighlighted dates represent context/status notes, not due tasks.
    if (dueMeta.hasAnyDateText && !dueMeta.hasExplicitDate) {
      continue
    }

    const blockId = block.paragraphAttrs?.id || block.itemAttrs?.id
    if (!blockId) continue

    nextSteps.push({
      text,
      blockId,
      dueBucket: dueMeta.dueBucket,
      isOverdue: dueMeta.isOverdue,
      hasExplicitDate: dueMeta.hasExplicitDate,
    })
  }

  return nextSteps
}

export const buildCandidatesForModel = (trackerPages: any[], today: string) => {
  const nextSteps = (trackerPages || []).flatMap((page: any) =>
    extractNextStepsFromContent(page?.content, today),
  )

  const cidToBlockId = new Map<string, string>()
  const cidToText = new Map<string, string>()

  const candidates: CandidateForModel[] = nextSteps.map((item, idx) => {
    const cid = `c${idx + 1}`
    cidToBlockId.set(cid, item.blockId)
    cidToText.set(cid, item.text)

    return {
      cid,
      text: item.text,
      due_bucket: item.dueBucket,
      is_overdue: item.isOverdue,
      has_explicit_date: item.hasExplicitDate,
    }
  })

  return {
    candidates,
    cidToBlockId,
    cidToText,
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

export const mapTasksFromCids = (
  tasks: any[],
  allowedCids: Set<string>,
  cidToBlockId: Map<string, string>,
  cidToText: Map<string, string>,
) => {
  let removedForInvalidCids = 0

  const mapped = (tasks || [])
    .map((task) => {
      if (!Array.isArray(task?.cids)) {
        removedForInvalidCids += 1
        return null
      }

      const validCids = task.cids.filter((cid: string) => allowedCids.has(cid))
      removedForInvalidCids += task.cids.length - validCids.length
      if (!validCids.length) return null

      const uniqueCids = Array.from(new Set(validCids))
      const blockIds = uniqueCids
        .map((cid) => cidToBlockId.get(cid))
        .filter((id): id is string => Boolean(id))

      if (!blockIds.length) return null

      const fallbackTaskText = uniqueCids
        .map((cid) => cidToText.get(cid))
        .filter((value): value is string => Boolean(value))
        .join(' + ')

      const nextTaskText = String(task?.task || '').trim() || fallbackTaskText
      if (!nextTaskText) return null

      const nextPriority = ['high', 'medium', 'low'].includes(task?.priority)
        ? task.priority
        : 'medium'

      return {
        task: nextTaskText,
        block_ids: blockIds,
        priority: nextPriority,
      }
    })
    .filter((task): task is { task: string, block_ids: string[], priority: string } => Boolean(task))

  return {
    mapped,
    removedForInvalidCids,
  }
}
