export type DueBucket = 'overdue' | 'today' | 'soon' | 'later' | 'none'

export type NextStepItem = {
  text: string
  blockId: string
  ageDays: number | null
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
  age_days: number | null
}

export type ParsedTaskBuckets = {
  asap: any[]
  fyi: any[]
  stale: any[]
  format: 'empty' | 'legacy_array' | 'legacy_tasks' | 'asap_fyi'
}

const DAY_MS = 24 * 60 * 60 * 1000

const toUtcDate = (value: string) => {
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const parseCandidateDueDate = (text: string, defaultYear: number) => {
  const dateMatch = text.match(
    /(?:\b(?:by|due|on|eod|end of day)\b[^0-9]{0,8})?[\[(]?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?[\])]?/i,
  )
  if (!dateMatch) return null

  const month = Number(dateMatch[1])
  const day = Number(dateMatch[2])
  const yearRaw = dateMatch[3]

  let year = defaultYear
  if (yearRaw) {
    const parsedYear = Number(yearRaw)
    if (!Number.isFinite(parsedYear)) return null
    if (yearRaw.length === 2) {
      year = 2000 + parsedYear
    } else {
      year = parsedYear
    }
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const dueDate = new Date(Date.UTC(year, month - 1, day))
  if (
    dueDate.getUTCFullYear() !== year ||
    dueDate.getUTCMonth() !== month - 1 ||
    dueDate.getUTCDate() !== day
  ) {
    return null
  }

  return dueDate
}

const buildDueMetadata = (text: string, todayDate: Date) => {
  const dueDate = parseCandidateDueDate(text, todayDate.getUTCFullYear())
  if (!dueDate) {
    return {
      dueBucket: 'none' as DueBucket,
      isOverdue: false,
      hasExplicitDate: false,
    }
  }

  const diffDays = Math.floor((dueDate.getTime() - todayDate.getTime()) / DAY_MS)
  if (diffDays < 0) {
    return {
      dueBucket: 'overdue' as DueBucket,
      isOverdue: true,
      hasExplicitDate: true,
    }
  }
  if (diffDays === 0) {
    return {
      dueBucket: 'today' as DueBucket,
      isOverdue: false,
      hasExplicitDate: true,
    }
  }
  if (diffDays <= 2) {
    return {
      dueBucket: 'soon' as DueBucket,
      isOverdue: false,
      hasExplicitDate: true,
    }
  }

  return {
    dueBucket: 'later' as DueBucket,
    isOverdue: false,
    hasExplicitDate: true,
  }
}

export const extractNextStepsFromText = (text: string, today: string): NextStepItem[] => {
  const lines = String(text || '').split('\n')
  const nextSteps: NextStepItem[] = []
  let inNextSteps = false

  const todayDate = toUtcDate(today)
  if (!todayDate) return nextSteps

  const toAgeDays = (createdAt?: string) => {
    if (!createdAt) return null
    const createdDate = new Date(createdAt)
    if (Number.isNaN(createdDate.getTime())) return null
    const diffDays = Math.floor((todayDate.getTime() - createdDate.getTime()) / DAY_MS)
    return Math.max(0, diffDays)
  }

  const isNextStepsHeader = (value: string) => /^next steps:?\s*/i.test(value)
  const isListLine = (value: string) =>
    value.startsWith('- ') ||
    /^\d+\.\s+/.test(value) ||
    /^\[(?: |x|X)\]\s+/.test(value)

  const cleanListText = (value: string) =>
    value
      .replace(/^\-\s+/, '')
      .replace(/^\d+\.\s+/, '')
      .replace(/^\[(?: |x|X)\]\s+/, '')
      .trim()

  for (const line of lines) {
    const trimmed = line.trim()
    if (isNextStepsHeader(trimmed)) {
      inNextSteps = true
      continue
    }

    if (!inNextSteps) {
      continue
    }

    if (!trimmed) {
      continue
    }

    if (!isListLine(trimmed)) {
      inNextSteps = false
      continue
    }

    const idMatch = line.match(/{{id:([^}]+)}}/)
    const createdAtMatch = line.match(/{{created_at:([^}]+)}}/)
    const blockId = idMatch?.[1]
    const createdAt = createdAtMatch?.[1]

    const cleaned = cleanListText(trimmed)
      .replace(/\s*{{id:[^}]+}}/g, '')
      .replace(/\s*{{created_at:[^}]+}}/g, '')
      .trim()

    if (!blockId || !cleaned) {
      continue
    }

    const dueMeta = buildDueMetadata(cleaned, todayDate)

    nextSteps.push({
      text: cleaned,
      blockId,
      ageDays: toAgeDays(createdAt),
      dueBucket: dueMeta.dueBucket,
      isOverdue: dueMeta.isOverdue,
      hasExplicitDate: dueMeta.hasExplicitDate,
    })
  }

  return nextSteps
}

export const buildCandidatesForModel = (trackerPages: any[], today: string) => {
  const nextSteps = (trackerPages || []).flatMap((page: any) =>
    extractNextStepsFromText(page?.textContent || '', today),
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
      age_days: Number.isInteger(item.ageDays) ? item.ageDays : null,
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
  let stale: any[] = []
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

    if (Array.isArray(parsed)) {
      asap = parsed
      format = 'legacy_array'
    } else if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.asap)) asap = parsed.asap
      if (Array.isArray(parsed.fyi)) fyi = parsed.fyi
      if (Array.isArray(parsed.stale)) stale = parsed.stale

      if (Array.isArray(parsed.asap) || Array.isArray(parsed.fyi) || Array.isArray(parsed.stale)) {
        format = 'asap_fyi'
      } else if (Array.isArray(parsed.tasks)) {
        asap = parsed.tasks
        format = 'legacy_tasks'
      }
    }
  } catch {
    asap = []
    fyi = []
    stale = []
    format = 'empty'
  }

  return { asap, fyi, stale, format }
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
