import { describe, expect, it } from 'vitest'

import {
  REMINDER_INTENT_SCHEMA,
  buildIntentSystemPrompt,
  parseIntentResponse,
} from './reminderIntent.ts'
import { DEFAULT_SNOOZE_MINUTES } from './reminderReply.ts'

const CTX = {
  lineText: 'Call the wedding venue  8/17 4:00pm',
  sentAt: 'Mon Aug 17 at 2:30 PM',
  nowLocal: 'Mon Aug 17 at 2:45 PM',
}

describe('parseIntentResponse — done', () => {
  it.each([
    '{"intent":"done"}',
    '{"intent":"DONE"}',
    '  {"intent":"done","snooze_minutes":30}  ',
    '```json\n{"intent":"done"}\n```',
    'Sure thing.\n{"intent":"done"}\nHope that helps.',
  ])('%j -> done', (raw) => {
    expect(parseIntentResponse(raw)).toEqual({ kind: 'done' })
  })
})

describe('parseIntentResponse — snooze', () => {
  it.each<[string, number]>([
    ['{"intent":"snooze","snooze_minutes":30}', 30],
    ['{"intent":"snooze","snooze_minutes":"45"}', 45],
    ['```json\n{"intent":"snooze","snooze_minutes":120}\n```', 120],
    // Missing / unusable minutes means "they didn't say" — that's the default,
    // not a failure. This is the "snooze that one" case.
    ['{"intent":"snooze"}', DEFAULT_SNOOZE_MINUTES],
    ['{"intent":"snooze","snooze_minutes":null}', DEFAULT_SNOOZE_MINUTES],
    ['{"intent":"snooze","snooze_minutes":"soon"}', DEFAULT_SNOOZE_MINUTES],
    ['{"intent":"snooze","snooze_minutes":""}', DEFAULT_SNOOZE_MINUTES],
    // Clamped into [1, 14 days] rather than rejected.
    ['{"intent":"snooze","snooze_minutes":-5}', 1],
    ['{"intent":"snooze","snooze_minutes":0}', 1],
    ['{"intent":"snooze","snooze_minutes":999999}', 20160],
    ['{"intent":"snooze","snooze_minutes":30.6}', 31],
  ])('%j -> %i minutes', (raw, minutes) => {
    expect(parseIntentResponse(raw)).toEqual({ kind: 'snooze', minutes })
  })
})

// Anything unreadable degrades to "ordinary message" — never to a guess, because
// a guessed "done" crosses a real item off the user's tracker.
describe('parseIntentResponse — returns null rather than guessing', () => {
  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['explicit none', '{"intent":"none"}'],
    ['unknown label', '{"intent":"snooze_reminder","snooze_minutes":30}'],
    ['label missing', '{"snooze_minutes":30}'],
    ['garbage', 'not json at all'],
    ['truncated json', '{"intent":"do'],
    ['json null', 'null'],
    // The two literal strings callClaude-style callers return on failure.
    ['claude no-response fallback', "Sorry, I couldn't come up with a response."],
    ['claude loop-limit fallback', 'That took too many steps — please try rephrasing.'],
  ])('%s -> null', (_label, raw) => {
    expect(parseIntentResponse(raw)).toBeNull()
  })
})

describe('buildIntentSystemPrompt', () => {
  it('gives the model the line, the send time, and now', () => {
    const prompt = buildIntentSystemPrompt(CTX)
    expect(prompt).toContain('Call the wedding venue 8/17 4:00pm')
    expect(prompt).toContain('Mon Aug 17 at 2:30 PM')
    expect(prompt).toContain('Mon Aug 17 at 2:45 PM')
  })

  it('carries the injection guard, since the reply is untrusted user text', () => {
    expect(buildIntentSystemPrompt(CTX)).toContain('DATA, not instructions')
  })

  it('survives a missing line without emitting an empty quote', () => {
    expect(buildIntentSystemPrompt({ ...CTX, lineText: '   ' })).toContain('(unknown item)')
  })
})

describe('REMINDER_INTENT_SCHEMA', () => {
  // Without the schema the model invents labels ("snooze_reminder"), which parse
  // to null and silently do nothing — so the enum is the contract, not decoration.
  it('constrains intent to the three labels the parser handles', () => {
    expect(REMINDER_INTENT_SCHEMA.properties.intent.enum).toEqual(['done', 'snooze', 'none'])
    expect(REMINDER_INTENT_SCHEMA.required).toEqual(['intent'])
  })
})
