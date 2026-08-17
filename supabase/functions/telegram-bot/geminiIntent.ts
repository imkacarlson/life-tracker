// Gemini client for the reminder-reply intent classifier.
//
// Shape mirrors generateSummary in check-scores/index.ts: raw fetch, three
// attempts, linear backoff, permanent-4xx short-circuit. All the prompt building
// and response parsing is pure and lives in ../_shared/reminderIntent.ts, which is
// where the unit tests are — this module is only the network edge.
//
// It never throws: every failure path returns null, which the caller reads as
// "ordinary message" and routes to the normal conversational flow. Same contract
// as capture.ts classifyReply.

import {
  REMINDER_INTENT_SCHEMA,
  buildIntentSystemPrompt,
  parseIntentResponse,
  type IntentContext,
} from '../_shared/reminderIntent.ts'
import type { ReminderAction } from '../_shared/reminderReply.ts'

// Its OWN secret, deliberately separate from check-scores' GEMINI_SCORES_API_KEY,
// so the two features fail — and get rate-limited — independently.
const API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''

// This classifier needs no grounding, so the free tier serves a 3.x model fine.
// (check-scores does need google_search and therefore has to stay on 2.5 — see
// the note there before "upgrading" it.)
const MODEL = 'gemini-3.5-flash-lite'
const MAX_ATTEMPTS = 3
// Per-attempt ceiling. Typical latency is well under a second; this only exists
// so a hung connection can't eat the webhook's 55s budget.
const TIMEOUT_MS = 8_000

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * Label a reply to a reminder as done / snooze / neither.
 *
 * Returns null for "this is just a message" and for every error, so the caller
 * has exactly one thing to check.
 */
export async function classifyReminderIntent(
  userText: string,
  ctx: IntentContext,
): Promise<ReminderAction> {
  if (!API_KEY) return null

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: buildIntentSystemPrompt(ctx) }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: REMINDER_INTENT_SCHEMA,
      // Do NOT add `thinkingConfig` here. thinkingBudget: 0 is rejected outright
      // (400 INVALID_ARGUMENT) by this model — verified against the live API.
      // Omitting the field is the only thing that works; it is not an oversight.
    },
  })

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(`${ENDPOINT}/${MODEL}:generateContent?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })

      if (resp.ok) {
        const data = await resp.json()
        // A clean "none" and an unreadable answer both mean "ordinary message",
        // and retrying either would add latency to every chat message. Stop here.
        return parseIntentResponse(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '')
      }

      console.error(`classifyReminderIntent: Gemini ${resp.status} (${attempt}/${MAX_ATTEMPTS})`)
      // 4xx other than 429 are permanent — don't spend retries on them.
      if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) return null
    } catch (err) {
      console.error(`classifyReminderIntent failed (${attempt}/${MAX_ATTEMPTS}):`, String(err))
    }

    // Linear backoff, shorter than the check-scores batch job's: this runs inline
    // in the user's round-trip, so they are watching the "typing…" indicator.
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
    }
  }

  return null
}
