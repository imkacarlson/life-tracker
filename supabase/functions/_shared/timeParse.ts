// Clock-time parsing for the text that immediately follows a highlighted date.
//
// HOUSE RULE: zero jsr:/npm:/https:// imports, zero top-level `Deno.*` — Vitest
// imports this directly.
//
// Design constraint that outranks everything else here: 573 of the user's 597
// existing highlighted dates carry NO time and must keep behaving exactly as they
// do today (daily list, never a push). So the grammar REQUIRES an unambiguous
// marker — a bare number after a date never arms a reminder.

export type ParsedTime = {
  hour: number // 0-23
  minute: number
  /** Length of the matched run, so callers can advance past it. */
  length: number
}

// Anchored at the start of the tail (the text right after the date token).
//   [\s,]*      optional separator: "8/17, 8:20am"
//   (@)|(at)    explicit markers that make a bare hour unambiguous
//   (\d{1,2})   hour
//   (:(\d{2}))? minutes
//   meridiem    am/pm, optionally dotted
//   (?![\w/:.]) the guard that kills "8/17 2026", "8/17 3rd", "8/17 5k",
//               "8/17 1400", "8/17 8.20am" and slash-years
export const TIME_RE =
  /^[\s,]*(?:(@)\s*|(at)\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.m\.|am|p\.m\.|pm)?(?![\w/:.])/i

/**
 * Parse a clock time at the very start of `tail`.
 *
 * Accepted only when the time is unambiguous: it has minutes, or a meridiem, or
 * an explicit "@"/"at" marker.
 *
 * Bare-hour disambiguation (no meridiem):
 *   0:xx        -> midnight
 *   1:00-6:59   -> +12 (PM — nobody schedules 1am)
 *   7:00-11:59  -> as written (AM)
 *   12:00-12:59 -> noon
 *   13:00-23:59 -> 24-hour, as written
 * An explicit meridiem always wins ("12:00 AM" -> 00:00).
 */
export function parseTimeAfterDate(tail: string): ParsedTime | null {
  const match = String(tail ?? '').match(TIME_RE)
  if (!match) return null

  const [full, at, atWord, hourRaw, minuteRaw, meridiemRaw] = match
  const marked = Boolean(at || atWord)
  const hasMinutes = minuteRaw !== undefined
  const meridiem = meridiemRaw ? meridiemRaw.replace(/\./g, '').toLowerCase() : undefined

  // Ambiguous bare number ("8/17 5") — never arm a reminder off that.
  if (!hasMinutes && !meridiem && !marked) return null

  let hour = Number(hourRaw)
  const minute = hasMinutes ? Number(minuteRaw) : 0
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  if (minute > 59) return null

  if (meridiem) {
    if (hour > 12 || hour === 0) return null
    if (meridiem === 'pm' && hour !== 12) hour += 12
    if (meridiem === 'am' && hour === 12) hour = 0
  } else {
    if (hour > 23) return null
    if (hour >= 1 && hour <= 6) hour += 12
  }

  return { hour, minute, length: full.length }
}
