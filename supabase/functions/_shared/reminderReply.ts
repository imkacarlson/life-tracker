// Deterministic keyword routing for a reply to a reminder — no AI call.
//
// HOUSE RULE: zero jsr:/npm:/https:// imports, zero top-level `Deno.*`.
//
// Deliberately strict: only a message that is ESSENTIALLY JUST the keyword
// counts. Anything chattier falls through to the normal conversational flow, so
// this can never hijack a real question.

import { parseDurationPhrase } from './leadTime.ts'

export const DEFAULT_SNOOZE_MINUTES = 60

export type ReminderAction =
  | { kind: 'done' }
  | { kind: 'snooze'; minutes: number }
  | null

const DONE_RE =
  /^(done|did it|did that|did|finished|finish|complete|completed|handled|taken care of|✅|☑️|✔️)$/i

// "snooze", "snooze 30m", "snooze for 2 hours", "remind me in 1 hour",
// "remind me again in 30 min", "later".
const SNOOZE_RES = [
  /^snooze(?:\s+for)?\s*(.*)$/i,
  /^remind\s+me(?:\s+again)?(?:\s+in|\s+for)?\s*(.*)$/i,
  /^later$/i,
]

const normalize = (text: string) =>
  String(text ?? '')
    .trim()
    .replace(/^[\s"'“”]+|[\s"'“”.!]+$/g, '')
    .replace(/\s+/g, ' ')

/**
 * Classify a bare reply. Returns null for anything that isn't unambiguously a
 * "done" or a "snooze" — the caller then treats it as an ordinary message.
 */
export function parseReminderReply(text: string): ReminderAction {
  const cleaned = normalize(text)
  if (!cleaned) return null

  if (DONE_RE.test(cleaned)) return { kind: 'done' }

  for (const re of SNOOZE_RES) {
    const match = cleaned.match(re)
    if (!match) continue
    const rest = (match[1] ?? '').trim()
    if (!rest) return { kind: 'snooze', minutes: DEFAULT_SNOOZE_MINUTES }
    const minutes = parseDurationPhrase(rest)
    if (minutes) return { kind: 'snooze', minutes }
    // "remind me about the dentist" — a real message, not a snooze.
    return null
  }

  return null
}
