import { describe, expect, it } from 'vitest'

import {
  formatInZone,
  localHour,
  localIsoDate,
  localWallClock,
  wallClockToUtc,
  zoneOffsetMs,
} from './wallClock.ts'

const NY = 'America/New_York'
const HOUR = 3600_000

const iso = (ts: number) => new Date(ts).toISOString()

describe('wallClockToUtc', () => {
  it('converts an EDT summer wall clock', () => {
    // 8:20 AM on Aug 17 2026 in New York (UTC-4) is 12:20 UTC.
    const { ts, shifted } = wallClockToUtc(
      { year: 2026, month: 8, day: 17, hour: 8, minute: 20 },
      NY,
    )
    expect(iso(ts)).toBe('2026-08-17T12:20:00.000Z')
    expect(shifted).toBe(false)
  })

  it('converts an EST winter wall clock', () => {
    // 8:20 AM on Jan 17 2027 in New York (UTC-5) is 13:20 UTC.
    const { ts } = wallClockToUtc({ year: 2027, month: 1, day: 17, hour: 8, minute: 20 }, NY)
    expect(iso(ts)).toBe('2027-01-17T13:20:00.000Z')
  })

  it('handles a half-hour offset zone', () => {
    const { ts } = wallClockToUtc(
      { year: 2026, month: 8, day: 17, hour: 8, minute: 20 },
      'Asia/Kolkata',
    )
    expect(iso(ts)).toBe('2026-08-17T02:50:00.000Z')
  })

  it('flags the spring-forward gap and converges forward', () => {
    // 2026-03-08 02:30 does not exist in New York; it lands on 03:30 EDT.
    const { ts, shifted } = wallClockToUtc(
      { year: 2026, month: 3, day: 8, hour: 2, minute: 30 },
      NY,
    )
    expect(shifted).toBe(true)
    expect(localWallClock(ts, NY).hour).toBe(3)
  })

  it('picks the first (DST) occurrence of an ambiguous fall-back time', () => {
    // 2026-11-01 01:30 happens twice; the EDT one is 05:30Z, the EST one 06:30Z.
    const { ts } = wallClockToUtc({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, NY)
    expect(iso(ts)).toBe('2026-11-01T05:30:00.000Z')
  })

  it('round-trips any well-defined wall clock', () => {
    for (let day = 1; day <= 28; day += 3) {
      for (const hour of [0, 7, 13, 22, 23]) {
        const wall = { year: 2026, month: 6, day, hour, minute: 45 }
        const { ts } = wallClockToUtc(wall, NY)
        expect(localWallClock(ts, NY)).toEqual(wall)
      }
    }
  })
})

describe('zoneOffsetMs', () => {
  it('is -4h during EDT and -5h during EST', () => {
    expect(zoneOffsetMs(Date.parse('2026-08-17T12:00:00Z'), NY)).toBe(-4 * HOUR)
    expect(zoneOffsetMs(Date.parse('2026-01-17T12:00:00Z'), NY)).toBe(-5 * HOUR)
  })
})

// The `today` trap: generate-daily receives `today` from the browser, but the
// cron function has to compute it. toISOString().slice(0,10) already says
// "tomorrow" at 8pm Eastern, which would shift the whole year ladder by a day for
// five hours every night.
describe('localIsoDate — the `today` trap', () => {
  it('is still the previous local day at 02:00 UTC in New York', () => {
    const instant = Date.parse('2026-08-18T02:00:00Z')
    expect(localIsoDate(instant, NY)).toBe('2026-08-17')
    expect(new Date(instant).toISOString().slice(0, 10)).toBe('2026-08-18') // the trap
  })

  it('rolls at local midnight, not UTC midnight', () => {
    expect(localIsoDate(Date.parse('2026-08-18T03:59:00Z'), NY)).toBe('2026-08-17')
    expect(localIsoDate(Date.parse('2026-08-18T04:00:00Z'), NY)).toBe('2026-08-18')
  })
})

describe('localHour', () => {
  it('reports 0 (not 24) at exactly local midnight', () => {
    expect(localHour(Date.parse('2026-08-18T04:00:00Z'), NY)).toBe(0)
  })

  it('reports the local hour, not the UTC one', () => {
    expect(localHour(Date.parse('2026-08-17T12:20:00Z'), NY)).toBe(8)
  })
})

describe('formatInZone', () => {
  it('formats for the reminder body', () => {
    expect(formatInZone(Date.parse('2026-08-17T12:20:00Z'), NY)).toBe('Mon Aug 17 · 8:20 AM')
  })

  it('takes a custom separator for the bot confirmation', () => {
    expect(formatInZone(Date.parse('2026-08-17T12:20:00Z'), NY, ' at ')).toBe(
      'Mon Aug 17 at 8:20 AM',
    )
  })
})
