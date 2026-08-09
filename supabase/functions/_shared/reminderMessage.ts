// Wording for the outbound reminder text and for the bot's post-confirmation
// "here's what I'll do" line.
//
// HOUSE RULE: zero jsr:/npm:/https:// imports, zero top-level `Deno.*`.

import { deriveFromSegments, type DeriveOptions, type TimedDate } from './deriveReminders.ts'
import { splitDateTokens } from './dateToken.ts'
import { formatInZone } from './wallClock.ts'
import type { InlineSegment } from './dailyHelpers.ts'

const MAX_BODY_CHARS = 200

/** "90 minutes" / "2 hours" / "1 day". */
export function describeLead(minutes: number): string {
  if (minutes <= 0) return 'now'
  if (minutes < 120) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  if (minutes % 1440 === 0) {
    const days = minutes / 1440
    return `${days} day${days === 1 ? '' : 's'}`
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return `${hours} hour${hours === 1 ? '' : 's'}`
  }
  return `${minutes} minutes`
}

/**
 * The line's text as a person should read it: the lead-time instruction removed
 * (it's machine-facing, and it's already restated in the header), whitespace
 * collapsed, and trimmed to a sane length for a push notification.
 */
export function cleanLineText(
  lineText: string,
  leadMatch: { start: number; end: number } | null,
): string {
  const source = String(lineText ?? '')
  const stripped = leadMatch
    ? source.slice(0, leadMatch.start) + source.slice(leadMatch.end)
    : source

  const collapsed = stripped
    .replace(/\(\s*\)/g, '') // an emptied parenthetical
    .replace(/\s+/g, ' ')
    .trim()

  if (collapsed.length <= MAX_BODY_CHARS) return collapsed
  return collapsed.slice(0, MAX_BODY_CHARS - 1).trimEnd() + '…'
}

/**
 * The outbound text. Plain — no parse_mode. This function emits a fixed format we
 * control, so it skips the escaping machinery telegram.ts needs for model output,
 * and Telegram auto-links the bare URL.
 */
export function buildReminderText(
  reminder: Pick<TimedDate, 'dueAt' | 'leadMinutes' | 'lineText' | 'leadMatch'>,
  timeZone: string,
  deepLink: string,
): string {
  const header =
    reminder.leadMinutes > 0 ? `⏰ In ${describeLead(reminder.leadMinutes)}` : '⏰ Now'
  const body = cleanLineText(reminder.lineText, reminder.leadMatch)
  const when = formatInZone(reminder.dueAt, timeZone)

  const lines = [body ? `${header} — ${body}` : header, '', when]
  if (deepLink) lines.push('', deepLink)
  return lines.join('\n')
}

/**
 * What the bot promises right after the user confirms an addition.
 *
 * Runs the SAME deriveFromSegments the cron sweep uses, over the SAME
 * {{date:…}} strings that were persisted with the job — so the bot cannot claim a
 * reminder the sweep won't send. If the parser can't read it, this stays silent
 * and the discrepancy is immediately visible.
 */
export function describeArmedReminders(
  items: string[],
  anchor: Date,
  opts: DeriveOptions,
): string {
  const lines: string[] = []

  for (const item of items ?? []) {
    const segments: InlineSegment[] = splitDateTokens(item).map((run) => ({
      text: run.text,
      highlighted: run.isDate,
    }))
    for (const timed of deriveFromSegments(segments, anchor, opts)) {
      lines.push(
        `⏰ I'll text you ${formatInZone(timed.fireAt, opts.timeZone, ' at ')} ` +
          `(${describeLead(timed.leadMinutes)} before).`,
      )
    }
  }

  return lines.join('\n')
}
