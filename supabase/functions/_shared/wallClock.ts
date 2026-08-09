// Wall-clock <-> UTC conversion for a fixed IANA time zone.
//
// HOUSE RULE for this module (and every pure module in _shared/): zero jsr:,
// npm:, or https:// imports and zero top-level `Deno.*`, so Vitest can import it
// directly. Intl only — the Deno edge runtime and Node both ship a full ICU, so
// zones resolve identically in both.
//
// Extends the Intl.formatToParts pattern already used in telegram-bot/datetime.ts.

export type WallClock = {
  year: number
  month: number // 1-12
  day: number
  hour: number // 0-23
  minute: number
}

// hourCycle:'h23' — NOT hour12:false. Older ICU emits "24" for midnight under
// hour12:false, which silently produces an off-by-one-day bug at exactly 00:00.
const partsFormatter = (timeZone: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

const readParts = (instant: Date | number, timeZone: string): WallClock & { second: number } => {
  const parts = partsFormatter(timeZone).formatToParts(new Date(instant))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0')
  let hour = get('hour')
  if (hour === 24) hour = 0 // defensive: older-ICU midnight quirk
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: get('minute'),
    second: get('second'),
  }
}

/** Offset of `timeZone` from UTC at `instant`, in ms (positive east of UTC). */
export const zoneOffsetMs = (instant: Date | number, timeZone: string): number => {
  const p = readParts(instant, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - new Date(instant).getTime()
}

/**
 * Turn a local wall-clock reading into a UTC timestamp, by two-pass fixed point:
 * guess with the offset at the naive instant, then re-solve once if that instant
 * turned out to sit on the other side of a DST transition.
 *
 * DST edges (both once a year, pre-dawn, inside quiet hours):
 *   - spring-forward gap (02:30 on a transition day) converges to 03:30 local;
 *     `shifted` is true so the caller can log it.
 *   - fall-back ambiguity picks the first (DST) occurrence.
 */
export const wallClockToUtc = (
  wall: WallClock,
  timeZone: string,
): { ts: number; shifted: boolean } => {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute)

  const roundTrips = (ts: number) => {
    const back = readParts(ts, timeZone)
    return back.day === wall.day && back.hour === wall.hour && back.minute === wall.minute
  }

  // Pass 1 uses the offset in effect at the naive instant; pass 2 re-solves with
  // the offset actually in effect at the answer. Exactly one of them round-trips
  // whenever the wall clock is well-defined.
  const first = naive - zoneOffsetMs(naive, timeZone)
  if (roundTrips(first)) return { ts: first, shifted: false }

  const second = naive - zoneOffsetMs(first, timeZone)
  if (roundTrips(second)) return { ts: second, shifted: false }

  // Neither round-trips: this wall clock doesn't exist (spring-forward gap). Keep
  // the pre-transition offset, which lands the caller just past the gap — 02:30
  // becomes 03:30 local rather than snapping backwards to 01:30.
  return { ts: first, shifted: true }
}

/** Local calendar date as YYYY-MM-DD. */
export const localIsoDate = (instant: Date | number, timeZone: string): string => {
  const p = readParts(instant, timeZone)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** Local hour of day, 0-23. */
export const localHour = (instant: Date | number, timeZone: string): number =>
  readParts(instant, timeZone).hour

/** Local wall-clock parts (no seconds) at an instant. */
export const localWallClock = (instant: Date | number, timeZone: string): WallClock => {
  const p = readParts(instant, timeZone)
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute }
}

/**
 * Human display of an instant in a zone, e.g. "Mon Aug 17 · 8:20 AM".
 * Fixed format — the reminder message controls its own presentation.
 */
export const formatInZone = (
  instant: Date | number,
  timeZone: string,
  separator = ' · ',
): string => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(new Date(instant))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return (
    `${get('weekday')} ${get('month')} ${get('day')}${separator}` +
    `${get('hour')}:${get('minute')} ${get('dayPeriod')}`
  )
}
