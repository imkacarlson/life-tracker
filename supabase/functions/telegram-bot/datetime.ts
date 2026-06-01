// Pure date/time helpers (Intl only — no Deno / jsr imports) so they can be
// unit-tested with Vitest. The Deno edge runtime and Node (vitest) both ship a
// full ICU, so IANA time zones resolve identically in both.
//
// Telegram never transmits the sender's device time zone (a message only carries
// text, the user ID, and a UTC timestamp). The user's local zone therefore comes
// from config (the USER_TIMEZONE secret), and these helpers turn a UTC instant
// into the user's local date parts.

/**
 * Format a UTC instant into the user's local date parts.
 *
 * @param now - the current instant (typically `new Date()`).
 * @param timeZone - an IANA time zone name, e.g. "America/New_York".
 * @returns month name ("May"), year ("2026"), and a human display string.
 */
export function formatNowInZone(
  now: Date,
  timeZone: string,
): { monthName: string; year: string; display: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(now)

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''

  return {
    monthName: get('month'),
    year: get('year'),
    display:
      `${get('weekday')}, ${get('month')} ${get('day')}, ${get('year')} at ` +
      `${get('hour')}:${get('minute')} ${get('dayPeriod')} (${timeZone})`,
  }
}
