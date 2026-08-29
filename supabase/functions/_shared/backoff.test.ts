import { describe, expect, it } from 'vitest'

import {
  BACKOFF_LADDER_MS,
  HEALTHY,
  RETRY_AFTER_CAP_SECONDS,
  applyFailure,
  applySuccess,
  backoffMs,
  classifyFailure,
  isBackedOff,
  parseRetryAfter,
  shouldTrip,
} from './backoff.ts'

const NOW = new Date('2026-08-29T12:00:00Z')

describe('classifyFailure', () => {
  it('treats 403 as a block, not a hiccup', () => {
    expect(classifyFailure(403)).toBe('blocked')
  })

  it('treats other deliberate refusals as blocks', () => {
    expect(classifyFailure(401)).toBe('blocked')
    expect(classifyFailure(451)).toBe('blocked')
  })

  it('treats 429 as rate limiting', () => {
    expect(classifyFailure(429)).toBe('rate_limited')
  })

  it('treats 5xx and network errors as transient', () => {
    expect(classifyFailure(500)).toBe('transient')
    expect(classifyFailure(503)).toBe('transient')
    expect(classifyFailure(null)).toBe('transient')
    expect(classifyFailure(undefined)).toBe('transient')
  })
})

describe('parseRetryAfter', () => {
  it('reads delta-seconds', () => {
    expect(parseRetryAfter('30', NOW)).toBe(30)
  })

  it('reads an HTTP date', () => {
    expect(parseRetryAfter('Sat, 29 Aug 2026 12:00:45 GMT', NOW)).toBe(45)
  })

  it('caps a long wait', () => {
    expect(parseRetryAfter('3600', NOW)).toBe(RETRY_AFTER_CAP_SECONDS)
    expect(parseRetryAfter('Sat, 29 Aug 2026 13:00:00 GMT', NOW)).toBe(RETRY_AFTER_CAP_SECONDS)
  })

  it('returns null for missing, empty, past, or unparseable values', () => {
    expect(parseRetryAfter(null, NOW)).toBeNull()
    expect(parseRetryAfter('', NOW)).toBeNull()
    expect(parseRetryAfter('   ', NOW)).toBeNull()
    expect(parseRetryAfter('later please', NOW)).toBeNull()
    expect(parseRetryAfter('0', NOW)).toBeNull()
    expect(parseRetryAfter('Sat, 29 Aug 2026 11:00:00 GMT', NOW)).toBeNull()
  })
})

describe('shouldTrip thresholds', () => {
  it('trips on the second consecutive 403', () => {
    expect(shouldTrip('blocked', 1)).toBe(false)
    expect(shouldTrip('blocked', 2)).toBe(true)
  })

  it('trips on the second consecutive refused 429', () => {
    expect(shouldTrip('rate_limited', 1)).toBe(false)
    expect(shouldTrip('rate_limited', 2)).toBe(true)
  })

  it('tolerates four transient failures before tripping on the fifth', () => {
    expect(shouldTrip('transient', 4)).toBe(false)
    expect(shouldTrip('transient', 5)).toBe(true)
  })
})

describe('backoff ladder', () => {
  it('climbs 1h → 2h → 4h → 8h → 24h', () => {
    expect(BACKOFF_LADDER_MS.map((ms) => ms / 3_600_000)).toEqual([1, 2, 4, 8, 24])
  })

  it('caps at the last rung and floors at the first', () => {
    expect(backoffMs(99)).toBe(24 * 3_600_000)
    expect(backoffMs(-1)).toBe(1 * 3_600_000)
  })
})

describe('isBackedOff', () => {
  it('is false with no window', () => {
    expect(isBackedOff({ backoff_until: null }, NOW)).toBe(false)
  })

  it('is true inside the window and false after it', () => {
    expect(isBackedOff({ backoff_until: '2026-08-29T12:30:00Z' }, NOW)).toBe(true)
    expect(isBackedOff({ backoff_until: '2026-08-29T11:30:00Z' }, NOW)).toBe(false)
  })

  it('is false for an unparseable timestamp rather than jamming forever', () => {
    expect(isBackedOff({ backoff_until: 'nonsense' }, NOW)).toBe(false)
  })
})

describe('applyFailure — 403 path', () => {
  it('warns once on the first 403 without tripping', () => {
    const first = applyFailure(HEALTHY, { kind: 'blocked', now: NOW })
    expect(first.alert).toBe('early_warning')
    expect(first.next.state).toBe('degraded')
    expect(first.next.consecutive_failures).toBe(1)
  })

  it('trips on the second and sets a 1h backoff', () => {
    const first = applyFailure(HEALTHY, { kind: 'blocked', now: NOW })
    const second = applyFailure(first.next, { kind: 'blocked', now: NOW })
    expect(second.alert).toBe('blocked')
    expect(second.next.state).toBe('blocked')
    expect(second.next.backoff_until).toBe('2026-08-29T13:00:00.000Z')
  })

  it('stays silent while blocked, climbing the ladder', () => {
    let snapshot = applyFailure(applyFailure(HEALTHY, { kind: 'blocked', now: NOW }).next, {
      kind: 'blocked',
      now: NOW,
    }).next

    const levels: number[] = []
    for (let i = 0; i < 6; i++) {
      const step = applyFailure(snapshot, { kind: 'blocked', now: NOW })
      expect(step.alert).toBeNull()
      levels.push(step.next.backoff_level)
      snapshot = step.next
    }
    expect(levels).toEqual([1, 2, 3, 4, 4, 4]) // caps at the 24h rung
  })
})

describe('applyFailure — transient path', () => {
  it('does not trip on four transient failures', () => {
    let snapshot = HEALTHY
    const alerts: Array<string | null> = []
    for (let i = 0; i < 4; i++) {
      const step = applyFailure(snapshot, { kind: 'transient', now: NOW })
      alerts.push(step.alert)
      snapshot = step.next
    }
    expect(alerts).toEqual(['early_warning', null, null, null])
    expect(snapshot.state).toBe('degraded')
  })

  it('trips on the fifth', () => {
    let snapshot = HEALTHY
    let last = applyFailure(snapshot, { kind: 'transient', now: NOW })
    for (let i = 0; i < 4; i++) {
      last = applyFailure(last.next, { kind: 'transient', now: NOW })
    }
    expect(last.alert).toBe('blocked')
    expect(last.next.state).toBe('blocked')
  })
})

describe('applyFailure — 429 honors Retry-After before tripping', () => {
  it('parks until the header says, without tripping, on the first refusal', () => {
    const step = applyFailure(HEALTHY, {
      kind: 'rate_limited',
      now: NOW,
      retryAfterSeconds: 60,
    })
    expect(step.next.state).toBe('degraded')
    expect(step.next.backoff_until).toBe('2026-08-29T12:01:00.000Z')
  })
})

describe('applySuccess', () => {
  it('is silent when nothing was wrong', () => {
    expect(applySuccess(HEALTHY)).toEqual({ next: HEALTHY, alert: null })
  })

  it('resets and announces recovery from degraded', () => {
    const degraded = applyFailure(HEALTHY, { kind: 'transient', now: NOW }).next
    const recovered = applySuccess(degraded)
    expect(recovered.alert).toBe('recovered')
    expect(recovered.next).toEqual(HEALTHY)
  })

  it('resets and announces recovery from blocked', () => {
    const blocked = applyFailure(applyFailure(HEALTHY, { kind: 'blocked', now: NOW }).next, {
      kind: 'blocked',
      now: NOW,
    }).next
    const recovered = applySuccess(blocked)
    expect(recovered.alert).toBe('recovered')
    expect(recovered.next.backoff_until).toBeNull()
    expect(recovered.next.consecutive_failures).toBe(0)
  })
})
