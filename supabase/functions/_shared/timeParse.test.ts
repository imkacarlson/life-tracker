import { describe, expect, it } from 'vitest'

import { parseTimeAfterDate } from './timeParse.ts'

// The tail is whatever follows the date token inside the SAME highlighted run.
const at = (tail: string) => {
  const parsed = parseTimeAfterDate(tail)
  return parsed ? `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}` : null
}

describe('parseTimeAfterDate — accepts', () => {
  const accepted: Array<[string, string]> = [
    [' 8:20am', '08:20'],
    [' 8:20 AM', '08:20'],
    [' 8:20 a.m.', '08:20'],
    [' 8pm', '20:00'],
    [' 8 PM', '20:00'],
    [' 20:00', '20:00'],
    [' @ 8:20 AM', '08:20'],
    [' @8:20', '08:20'],
    [' at 5', '17:00'],
    [' at 9', '09:00'],
    [', 8:20am', '08:20'],
    [' 8:20', '08:20'],
    [' 1:00', '13:00'], // bare 1-6 reads as PM
    [' 6:59', '18:59'],
    [' 7:00', '07:00'], // 7-11 reads as AM
    [' 12:00', '12:00'], // noon, not midnight
    [' 12:00 AM', '00:00'], // explicit meridiem always wins
    [' 12:30 PM', '12:30'],
    [' 0:30', '00:30'],
    [' 23:59', '23:59'],
  ]

  it.each(accepted)('%j -> %s', (tail, expected) => {
    expect(at(tail)).toBe(expected)
  })
})

// These rows matter most: they protect the 573 existing date-only highlights,
// which must keep going to the daily list and never buzz a phone.
describe('parseTimeAfterDate — rejects', () => {
  const rejected = [
    '', // "EOD 8/16" — nothing after the date
    ' weekend', // "2/22 weekend"
    ' 2026', // "8/17 2026"
    ' 3rd',
    ' 5k',
    ' 1400',
    ' 8.20am', // "." is deliberately not a separator ($8.50 would break)
    ' 25:00',
    ' 12:60',
    ' 13pm', // meridiem with an impossible hour
    ' 0pm',
    ' 5-10 miles', // bare number, no marker
    ' 5',
    '-8/19 7pm', // a range: the tail of the FIRST date starts with "-"
    ' /27', // slash-year leftovers never read as a time
  ]

  it.each(rejected)('%j -> null', (tail) => {
    expect(parseTimeAfterDate(tail)).toBeNull()
  })
})

it('reports the matched length so callers can advance past it', () => {
  const parsed = parseTimeAfterDate(' 8:20am — text me 2 hours before')
  expect(parsed?.length).toBe(' 8:20am'.length)
})
