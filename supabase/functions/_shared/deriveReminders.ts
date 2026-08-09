// Turn tracker documents into the complete set of reminders that SHOULD exist
// right now — deterministically, with zero AI tokens.
//
// HOUSE RULE: zero jsr:/npm:/https:// imports, zero top-level `Deno.*`.
//
// The contract that protects the user's 573 existing date-only highlights: a
// highlighted date arms a push ONLY if a clock time sits inside the same
// highlight. A bare date is, and stays, daily-list-only.

import {
  collectInlineSegments,
  extractDateTokens,
  resolveTokenDate,
  resolveTrackerAnchor,
  serializeTrackerToMarkdown,
  type InlineSegment,
} from './dailyHelpers.ts'
import { parseTimeAfterDate } from './timeParse.ts'
import { DEFAULT_LEAD_MINUTES, parseLeadTimes } from './leadTime.ts'
import { localWallClock, wallClockToUtc } from './wallClock.ts'

export type QuietHours = { startHour: number; endHour: number }

export type DeriveOptions = {
  /** Today's date in the USER's zone, YYYY-MM-DD. See the `today` trap below. */
  todayLocal: string
  timeZone: string
  defaultLeadMinutes?: number
  quiet?: QuietHours | null
}

export type TimedDate = {
  /** UTC ms of the event itself. */
  dueAt: number
  leadMinutes: number
  /** UTC ms the text should go out — lead applied, quiet hours resolved. */
  fireAt: number
  /** The raw date token, e.g. "8/17". */
  dateText: string
  /** The visual line the token sits on (hard breaks split a block into lines). */
  lineText: string
  /** Character range of the lead clause within lineText, if one was found. */
  leadMatch: { start: number; end: number } | null
  quietDeferred: boolean
  dstShifted: boolean
}

export type DerivedReminder = TimedDate & {
  dedupKey: string
  blockId: string
  pageId: string | null
  cid: string
}

const MS_PER_MINUTE = 60_000

/**
 * The user sometimes leaves the space BETWEEN a date and its time unhighlighted,
 * which would silently break pairing. Merge `highlighted, blank-plain,
 * highlighted` triples back into one run.
 *
 * Excludes `\n` deliberately: collectInlineSegments emits a newline segment for a
 * hardBreak, and a line break must break the pairing.
 */
export function mergeAdjacentHighlights(segments: InlineSegment[]): InlineSegment[] {
  const out: InlineSegment[] = []
  let i = 0
  while (i < segments.length) {
    const a = segments[i]
    const b = segments[i + 1]
    const c = segments[i + 2]
    if (a?.highlighted && c?.highlighted && b && !b.highlighted && /^[ \t]*$/.test(b.text)) {
      // Fold the triple, then keep folding onto it (a b c b c … chain).
      let text = a.text + b.text + c.text
      i += 3
      while (
        segments[i] &&
        !segments[i].highlighted &&
        /^[ \t]*$/.test(segments[i].text) &&
        segments[i + 1]?.highlighted
      ) {
        text += segments[i].text + segments[i + 1].text
        i += 2
      }
      out.push({ text, highlighted: true })
      continue
    }
    out.push(a)
    i += 1
  }
  return out
}

const inQuietWindow = (hour: number, quiet: QuietHours): boolean => {
  const { startHour, endHour } = quiet
  if (startHour === endHour) return false
  if (startHour < endHour) return hour >= startHour && hour < endHour
  return hour >= startHour || hour < endHour // window wraps midnight
}

/**
 * Quiet hours DEFER, they don't drop.
 *
 * The escape hatch matters: a 6am flight with a 90-minute lead fires at 4:30am
 * rather than being pushed to 7am, which would be after takeoff.
 */
export function deferPastQuietHours(
  fireAt: number,
  dueAt: number,
  timeZone: string,
  quiet: QuietHours | null | undefined,
): { fireAt: number; deferred: boolean } {
  if (!quiet) return { fireAt, deferred: false }

  const local = localWallClock(fireAt, timeZone)
  if (!inQuietWindow(local.hour, quiet)) return { fireAt, deferred: false }

  // Next endHour:00 local at or after fireAt.
  let target = { ...local, hour: quiet.endHour, minute: 0 }
  let solved = wallClockToUtc(target, timeZone).ts
  if (solved <= fireAt) {
    const next = new Date(Date.UTC(local.year, local.month - 1, local.day + 1))
    target = {
      year: next.getUTCFullYear(),
      month: next.getUTCMonth() + 1,
      day: next.getUTCDate(),
      hour: quiet.endHour,
      minute: 0,
    }
    solved = wallClockToUtc(target, timeZone).ts
  }

  if (solved > dueAt) return { fireAt, deferred: false }
  return { fireAt: solved, deferred: true }
}

/** The \n-delimited run of `text` containing `offset` — a hard break ends a line. */
const lineRunAt = (text: string, offset: number): { text: string; start: number } => {
  const start = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1
  const endIdx = text.indexOf('\n', offset)
  const end = endIdx === -1 ? text.length : endIdx
  return { text: text.slice(start, end), start }
}

/**
 * Every timed date on one block's inline runs. Shared by the cron sweep and the
 * bot's confirmation message, so the bot can never promise a reminder the sweep
 * won't send.
 */
export function deriveFromSegments(
  segments: InlineSegment[],
  anchor: Date,
  opts: DeriveOptions,
): TimedDate[] {
  const merged = mergeAdjacentHighlights(segments ?? [])
  const fullText = merged.map((s) => s.text).join('')
  const defaultLead = opts.defaultLeadMinutes ?? DEFAULT_LEAD_MINUTES
  const results: TimedDate[] = []

  let offset = 0
  for (const segment of merged) {
    if (!segment.highlighted) {
      offset += segment.text.length
      continue
    }

    // The date's year still follows the daily list's ladder over the whole block,
    // so a "(of 2027)" note anywhere on the line keeps working.
    for (const token of extractDateTokens(segment.text, 1970)) {
      const tail = segment.text.slice(token.index + token.raw.length)
      const time = parseTimeAfterDate(tail)
      if (!time) continue // date with no time inside the highlight -> never a push

      const { date } = resolveTokenDate(token, fullText, anchor)
      const due = wallClockToUtc(
        {
          year: date.getUTCFullYear(),
          month: date.getUTCMonth() + 1,
          day: date.getUTCDate(),
          hour: time.hour,
          minute: time.minute,
        },
        opts.timeZone,
      )

      // Lead phrases are scoped to the visual line: a phrase after a hard break
      // must not apply to a date before it.
      const run = lineRunAt(fullText, offset + token.index)
      const lead = parseLeadTimes(run.text)
      if (lead.suppressed) continue

      const leads = lead.minutes.length ? lead.minutes : [defaultLead]
      for (const leadMinutes of leads) {
        const raw = due.ts - leadMinutes * MS_PER_MINUTE
        const quiet = deferPastQuietHours(raw, due.ts, opts.timeZone, opts.quiet)
        results.push({
          dueAt: due.ts,
          leadMinutes,
          fireAt: quiet.fireAt,
          dateText: token.raw,
          lineText: run.text,
          leadMatch: lead.match,
          quietDeferred: quiet.deferred,
          dstShifted: due.shifted,
        })
      }
    }

    offset += segment.text.length
  }

  return results
}

/**
 * Identity of a derived reminder.
 *
 * Deliberately EXCLUDES the line text — fixing a typo must not re-fire.
 * Deliberately INCLUDES due_at and lead — editing either yields a new key, so the
 * corrected reminder fires and the stale one simply is never derived again.
 */
export const derivedDedupKey = (blockId: string, dueAt: number, leadMinutes: number): string =>
  `d:${blockId}:${new Date(dueAt).toISOString()}:${leadMinutes}`

export const snoozeDedupKey = (blockId: string, fireAt: number): string =>
  `s:${blockId}:${new Date(fireAt).toISOString()}`

export type ReminderPage = {
  id?: string
  pageId?: string
  title?: string
  content?: unknown
}

/**
 * Derive the complete reminder set from tracker pages.
 *
 * ⚠️ THE `today` TRAP: `opts.todayLocal` must be computed with
 * localIsoDate(now, tz) — NOT `toISOString().slice(0,10)`, which already says
 * "tomorrow" at 8pm Eastern and would shift the whole year ladder by a day for
 * five hours every night.
 */
export function deriveReminders(
  pages: ReminderPage[],
  opts: DeriveOptions,
): DerivedReminder[] {
  const out: DerivedReminder[] = []

  ;(pages ?? []).forEach((page, pageIdx) => {
    // Per page, so each page's bare dates anchor to that page's own month and the
    // pageId is known without a second lookup.
    const { cidToBlockId, cidSegments } = serializeTrackerToMarkdown(page?.content, page?.title)
    const anchor = resolveTrackerAnchor(page?.title, opts.todayLocal)
    const pageId = page?.pageId ?? page?.id ?? null

    for (const [cid, segments] of cidSegments) {
      const blockId = cidToBlockId.get(cid)
      if (!blockId) continue

      for (const timed of deriveFromSegments(segments, anchor, opts)) {
        out.push({
          ...timed,
          dedupKey: derivedDedupKey(blockId, timed.dueAt, timed.leadMinutes),
          blockId,
          pageId,
          cid: `p${pageIdx}-${cid}`,
        })
      }
    }
  })

  return out
}

/**
 * Diagnostic: highlighted runs that DO carry a clock time but never got an anchor,
 * and so can never become a reminder. Should be 0. Anything else is a new class of
 * unreachable date and deserves a loud warning rather than a silent no-op.
 */
export function countOrphanedTimedHighlights(
  pages: ReminderPage[],
  reachable: number,
): number {
  let total = 0

  const countBlock = (nodes: unknown[]) => {
    const merged = mergeAdjacentHighlights(collectInlineSegments(nodes as any[]))
    for (const segment of merged) {
      if (!segment.highlighted) continue
      for (const token of extractDateTokens(segment.text, 1970)) {
        if (parseTimeAfterDate(segment.text.slice(token.index + token.raw.length))) total += 1
      }
    }
  }

  const walk = (node: any) => {
    if (!node || typeof node !== 'object' || !Array.isArray(node.content)) return
    if (node.content.some((child: any) => child?.type === 'text')) {
      countBlock(node.content)
      return
    }
    node.content.forEach(walk)
  }

  ;(pages ?? []).forEach((page) => walk(page?.content))
  return Math.max(0, total - reachable)
}
