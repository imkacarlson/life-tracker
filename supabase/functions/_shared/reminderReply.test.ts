import { describe, expect, it } from 'vitest'

import { DEFAULT_SNOOZE_MINUTES, parseReminderReply } from './reminderReply.ts'

describe('parseReminderReply — done', () => {
  it.each(['done', 'Done', 'done.', 'did it', 'finished', 'completed', '✅', '  done  '])(
    '%j -> done',
    (text) => {
      expect(parseReminderReply(text)).toEqual({ kind: 'done' })
    },
  )
})

describe('parseReminderReply — snooze', () => {
  it.each<[string, number]>([
    ['snooze', DEFAULT_SNOOZE_MINUTES],
    ['snooze 1h', 60],
    ['snooze 30m', 30],
    ['snooze for 2 hours', 120],
    ['remind me in 30m', 30],
    ['remind me again in 1 hour', 60],
    ['later', DEFAULT_SNOOZE_MINUTES],
  ])('%j -> %i minutes', (text, minutes) => {
    expect(parseReminderReply(text)).toEqual({ kind: 'snooze', minutes })
  })
})

// The whole point of a strict parser: an ordinary message must never be
// hijacked into crossing something off the user's tracker.
describe('parseReminderReply — leaves real messages alone', () => {
  it.each([
    '',
    'what did I get done this week?',
    'is the dietician appointment done?',
    'remind me about the dentist',
    'add buy more gels to running',
    'done with the marathon block, what next?',
    'snooze the whole idea of running',
    'yes',
  ])('%j -> null', (text) => {
    expect(parseReminderReply(text)).toBeNull()
  })
})
