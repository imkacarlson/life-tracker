import { describe, it, expect } from 'vitest'
import { formatNowInZone } from './datetime.ts'

describe('formatNowInZone', () => {
  // 2026-06-01T02:00:00Z is still May 31 in America/New_York (UTC-4 in summer).
  const instant = new Date('2026-06-01T02:00:00Z')

  it('resolves date parts in the given time zone', () => {
    const { monthName, year } = formatNowInZone(instant, 'America/New_York')
    expect(monthName).toBe('May')
    expect(year).toBe('2026')
  })

  it('resolves the same instant differently in UTC', () => {
    const { monthName, year } = formatNowInZone(instant, 'UTC')
    expect(monthName).toBe('June')
    expect(year).toBe('2026')
  })

  it('builds a human display string including the zone', () => {
    const { display } = formatNowInZone(instant, 'America/New_York')
    expect(display).toContain('May 31, 2026')
    expect(display).toContain('(America/New_York)')
  })
})
