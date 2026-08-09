// "How early should I be told?" — parsed from the PLAIN text on the same line as
// a highlighted date. Highlight = when; line text = how early.
//
// HOUSE RULE: zero jsr:/npm:/https:// imports, zero top-level `Deno.*`.

export const DEFAULT_LEAD_MINUTES = 90

/** At most this many reminders from one line, however many clauses it carries. */
const MAX_LEADS = 3

const NUMWORD: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fortyfive: 45,
  sixty: 60,
  ninety: 90,
}

const UNIT_MIN: Record<string, number> = {
  m: 1,
  min: 1,
  mins: 1,
  minute: 1,
  minutes: 1,
  h: 60,
  hr: 60,
  hrs: 60,
  hour: 60,
  hours: 60,
  d: 1440,
  day: 1440,
  days: 1440,
  w: 10080,
  week: 10080,
  weeks: 10080,
}

// Longest-first so "minutes" is never cut short to "min".
const byLengthDesc = (keys: string[]) => keys.slice().sort((a, b) => b.length - a.length)
const UNITS_SRC = byLengthDesc(Object.keys(UNIT_MIN)).join('|')
const NUMWORDS_SRC = byLengthDesc(Object.keys(NUMWORD)).join('|')

// One quantity: "30 min", "an hour", "half an hour", "2h".
// The trailing \b is what stops "20 mi before work" from reading as a quantity.
const QTY_SRC = `(?:\\d+|half\\s+an?|${NUMWORDS_SRC})\\s*(?:${UNITS_SRC})\\b`
const QTY_G = new RegExp(`(\\d+|half\\s+an?|${NUMWORDS_SRC})\\s*(${UNITS_SRC})\\b`, 'gi')

// One or more quantities, then "before".
const LEAD_G = new RegExp(`(?:${QTY_SRC}[\\s,]*(?:and\\s+)?)+\\s*before\\b`, 'gi')

// A LEAD run only counts as an instruction if it's asked for. Either a trigger
// verb sits just before it, or the clause terminates the sentence/parenthetical.
const TRIGGER_RE = /\b(remind|text|ping|alert|notify|nudge|buzz|warn)\w*\b/i
const TRIGGER_WINDOW = 24
const TERMINAL_RE = /^\s*([)\].,;]|$)/

const SUPPRESS_RES = [
  /\bno\s+(reminder|alert|ping)s?\b/i,
  /\b(don'?t|do not)\s+(remind|text|ping|notify)\b/i,
]

/**
 * A standalone duration phrase ("30m", "2 hours", "an hour", "1 day") in minutes,
 * or null if the whole string isn't one. Used by the snooze parser, which needs
 * the quantity grammar without the "before" clause around it.
 */
export function parseDurationPhrase(text: string): number | null {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return null
  const exact = new RegExp(`^(\\d+|half\\s+an?|${NUMWORDS_SRC})\\s*(${UNITS_SRC})$`, 'i')
  const match = trimmed.match(exact)
  if (!match) return null
  const minutes = quantityMinutes(match[1], match[2])
  return minutes > 0 ? Math.round(minutes) : null
}

export type LeadResult = {
  /** The user explicitly asked for silence on this line. */
  suppressed: boolean
  /** Lead times in minutes. Empty means "no clause found — use the default". */
  minutes: number[]
  /** Character range of the matched clause, so callers can strip it from display text. */
  match: { start: number; end: number } | null
}

const quantityMinutes = (numRaw: string, unitRaw: string): number => {
  const unit = UNIT_MIN[unitRaw.toLowerCase()] ?? 0
  const token = numRaw.trim().toLowerCase()
  if (/^\d+$/.test(token)) return Number(token) * unit
  if (token.startsWith('half')) return unit / 2
  return (NUMWORD[token] ?? 0) * unit
}

/**
 * Read a lead-time instruction out of a line.
 *
 * Acceptance, in priority order:
 *   1. Suppression wins outright.
 *   2. A quantity clause with a trigger verb within ~24 chars before it.
 *   3. A quantity clause that terminates the sentence or parenthetical.
 *   4. Otherwise no clause — the caller uses its default.
 *
 * Rules 2-3 exist to stop ordinary prose from silently rewriting its own lead
 * time: "finish 3 days before the wedding" is a description, not an instruction.
 */
export function parseLeadTimes(text: string): LeadResult {
  const line = String(text ?? '')
  if (SUPPRESS_RES.some((re) => re.test(line))) {
    return { suppressed: true, minutes: [], match: null }
  }

  LEAD_G.lastIndex = 0
  let match: RegExpExecArray | null = LEAD_G.exec(line)
  while (match) {
    const start = match.index
    const end = start + match[0].length
    const windowStart = Math.max(0, start - TRIGGER_WINDOW)
    const before = line.slice(windowStart, start)
    const trigger = before.match(TRIGGER_RE)
    const accepted = Boolean(trigger) || TERMINAL_RE.test(line.slice(end))

    if (accepted) {
      const minutes = splitLeadParts(match[0])
      if (minutes.length) {
        // Report the clause INCLUDING its trigger verb, so stripping it for
        // display leaves "Call venue ()" rather than "Call venue (remind )".
        const clauseStart = trigger ? windowStart + (trigger.index ?? 0) : start
        return { suppressed: false, minutes, match: { start: clauseStart, end } }
      }
    }
    match = LEAD_G.exec(line)
  }

  return { suppressed: false, minutes: [], match: null }
}

// "1 hour 30 min before" is ONE lead of 90 minutes (adjacent quantities sum);
// "1 day and 2h before" is TWO leads (an explicit connector splits them).
function splitLeadParts(run: string): number[] {
  const parts = run.split(/\s*(?:,|\band\b)\s*/i)
  const leads: number[] = []

  for (const part of parts) {
    QTY_G.lastIndex = 0
    let total = 0
    let qty: RegExpExecArray | null = QTY_G.exec(part)
    while (qty) {
      total += quantityMinutes(qty[1], qty[2])
      qty = QTY_G.exec(part)
    }
    if (total > 0) leads.push(Math.round(total))
  }

  return leads.slice(0, MAX_LEADS)
}
