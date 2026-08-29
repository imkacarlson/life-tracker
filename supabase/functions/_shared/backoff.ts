// Circuit breaker for the ESPN fetch.
//
// The Aug 2026 outage was silent for three weeks because a non-OK response was
// swallowed and reported as "no games today". This module turns a failure into
// an explicit state transition, and transitions are what trigger alerts — so a
// sustained block sends ONE email, not 96 a day.
//
// HOUSE RULE: zero jsr:/npm:/https:// imports, zero top-level `Deno.*`.

export type FailureKind = 'blocked' | 'rate_limited' | 'transient'
export type HealthState = 'healthy' | 'degraded' | 'blocked'
export type AlertKind = 'blocked' | 'early_warning' | 'recovered'

/**
 * How many CONSECUTIVE failures of a kind before the breaker trips.
 * Different failures mean different things:
 *  - 403 is the block signal. The real one lasted 22 days; it is never transient.
 *  - 429 only counts once we have already honored Retry-After and been refused again.
 *  - 5xx/timeout are genuinely transient — 5 ticks is ~75 minutes, so a blip
 *    never trips it.
 */
export const TRIP_THRESHOLDS: Record<FailureKind, number> = {
  blocked: 2,
  rate_limited: 2,
  transient: 5,
}

/** Never sleep inside a run for longer than this on a Retry-After header. */
export const RETRY_AFTER_CAP_SECONDS = 120

/** Backoff ladder once tripped: 1h → 2h → 4h → 8h → 24h cap. */
export const BACKOFF_LADDER_MS = [
  1 * 60 * 60 * 1000,
  2 * 60 * 60 * 1000,
  4 * 60 * 60 * 1000,
  8 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
]

export type HealthSnapshot = {
  state: HealthState
  consecutive_failures: number
  backoff_level: number
  backoff_until: string | null
}

export const HEALTHY: HealthSnapshot = {
  state: 'healthy',
  consecutive_failures: 0,
  backoff_level: 0,
  backoff_until: null,
}

/** Map an HTTP status (or a thrown network error, `null`) to a failure kind. */
export function classifyFailure(status: number | null | undefined): FailureKind {
  if (status === 403) return 'blocked'
  if (status === 429) return 'rate_limited'
  // 401/451 are also deliberate refusals rather than hiccups.
  if (status === 401 || status === 451) return 'blocked'
  return 'transient'
}

/**
 * `Retry-After` as a number of seconds. Accepts both forms the spec allows
 * (delta-seconds and an HTTP date). Capped, because a server asking us to sleep
 * for an hour inside a 15-minute cron tick is a "come back later", not a wait.
 * Returns null when the header is absent or unusable.
 */
export function parseRetryAfter(header: string | null | undefined, now: Date): number | null {
  if (!header) return null
  const raw = String(header).trim()
  if (!raw) return null

  let seconds: number
  if (/^\d+$/.test(raw)) {
    seconds = Number(raw)
  } else {
    const when = Date.parse(raw)
    if (Number.isNaN(when)) return null
    seconds = Math.ceil((when - now.getTime()) / 1000)
  }

  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return Math.min(seconds, RETRY_AFTER_CAP_SECONDS)
}

/** Has this kind of failure now happened often enough in a row to trip? */
export function shouldTrip(kind: FailureKind, consecutiveFailures: number): boolean {
  return consecutiveFailures >= TRIP_THRESHOLDS[kind]
}

/** Backoff duration for a given rung of the ladder, clamped to the 24h cap. */
export function backoffMs(level: number): number {
  const index = Math.max(0, Math.min(level, BACKOFF_LADDER_MS.length - 1))
  return BACKOFF_LADDER_MS[index]
}

/** Are we still inside a backoff window? */
export function isBackedOff(snapshot: Pick<HealthSnapshot, 'backoff_until'>, now: Date): boolean {
  if (!snapshot.backoff_until) return false
  const until = Date.parse(snapshot.backoff_until)
  return Number.isFinite(until) && until > now.getTime()
}

export type Transition = {
  next: HealthSnapshot
  /** null means "no state change worth emailing about". */
  alert: AlertKind | null
}

/**
 * Fold one failed attempt into the health record.
 *
 * Alerts fire on TRANSITIONS only: healthy→degraded is the early warning,
 * →blocked is the block alert, and staying blocked is silent while the backoff
 * ladder climbs.
 */
export function applyFailure(
  prev: HealthSnapshot,
  options: { kind: FailureKind; now: Date; retryAfterSeconds?: number | null },
): Transition {
  const { kind, now } = options
  const consecutive = prev.consecutive_failures + 1

  if (prev.state === 'blocked') {
    const level = Math.min(prev.backoff_level + 1, BACKOFF_LADDER_MS.length - 1)
    return {
      next: {
        state: 'blocked',
        consecutive_failures: consecutive,
        backoff_level: level,
        backoff_until: new Date(now.getTime() + backoffMs(level)).toISOString(),
      },
      alert: null,
    }
  }

  if (shouldTrip(kind, consecutive)) {
    return {
      next: {
        state: 'blocked',
        consecutive_failures: consecutive,
        backoff_level: 0,
        backoff_until: new Date(now.getTime() + backoffMs(0)).toISOString(),
      },
      alert: 'blocked',
    }
  }

  const retryAfter = options.retryAfterSeconds ?? null
  return {
    next: {
      state: 'degraded',
      consecutive_failures: consecutive,
      backoff_level: 0,
      backoff_until: retryAfter ? new Date(now.getTime() + retryAfter * 1000).toISOString() : null,
    },
    alert: prev.state === 'degraded' ? null : 'early_warning',
  }
}

/** Any success resets everything, and announces recovery once. */
export function applySuccess(prev: HealthSnapshot): Transition {
  return {
    next: { ...HEALTHY },
    alert: prev.state === 'healthy' ? null : 'recovered',
  }
}
