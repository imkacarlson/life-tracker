import { describe, it, expect } from 'vitest'
import {
  computeSessionKey,
  computeSessionMode,
  computeSessionStatusSync,
} from '../trackerSessionHelpers'

const TRACKER_ID = 'abc-123'
const TRACKER_ID_2 = 'def-456'
const TRACKER = { id: TRACKER_ID, title: 'Test Page', content: { type: 'doc', content: [] } }

describe('computeSessionMode', () => {
  it('returns "template" when settingsMode is daily-template', () => {
    expect(computeSessionMode('daily-template', TRACKER_ID)).toBe('template')
  })

  it('returns "settings" when settingsMode is a non-template settings mode', () => {
    expect(computeSessionMode('something', TRACKER_ID)).toBe('settings')
    expect(computeSessionMode('other-settings', null)).toBe('settings')
  })

  it('returns "tracker" when no settingsMode and activeTrackerId is set', () => {
    expect(computeSessionMode(null, TRACKER_ID)).toBe('tracker')
    expect(computeSessionMode(undefined, TRACKER_ID)).toBe('tracker')
    expect(computeSessionMode(false, TRACKER_ID)).toBe('tracker')
    expect(computeSessionMode('', TRACKER_ID)).toBe('tracker')
  })

  it('returns "idle" when no settingsMode and no activeTrackerId', () => {
    expect(computeSessionMode(null, null)).toBe('idle')
    expect(computeSessionMode(undefined, undefined)).toBe('idle')
    expect(computeSessionMode(false, null)).toBe('idle')
  })
})

describe('computeSessionStatusSync', () => {
  it('returns "idle" when mode is "idle"', () => {
    expect(computeSessionStatusSync('idle', null, false)).toBe('idle')
  })

  it('returns "idle" when mode is "settings"', () => {
    expect(computeSessionStatusSync('settings', null, false)).toBe('idle')
  })

  it('returns "loading" when mode is "tracker" and activeTracker is null', () => {
    expect(computeSessionStatusSync('tracker', null, false)).toBe('loading')
  })

  it('returns "loading" when mode is "tracker" and activeTracker is null but dataLoading is true', () => {
    expect(computeSessionStatusSync('tracker', null, true)).toBe('loading')
  })

  it('returns "pending-hydration" when mode is "tracker" and activeTracker is available', () => {
    expect(computeSessionStatusSync('tracker', TRACKER, false)).toBe('pending-hydration')
  })

  it('returns "pending-hydration" when mode is "template"', () => {
    // Template content is always available (via ref); we always need to hydrate
    expect(computeSessionStatusSync('template', null, false)).toBe('pending-hydration')
  })
})

describe('computeSessionKey', () => {
  it('returns "idle" for idle mode', () => {
    expect(computeSessionKey('idle', null, 0, null, null)).toBe('idle')
  })

  it('returns "settings" for settings mode', () => {
    expect(computeSessionKey('settings', null, 0, null, null)).toBe('settings')
  })

  it('returns "loading:<trackerId>" while tracker content is loading', () => {
    expect(computeSessionKey('tracker', TRACKER_ID, 0, null, null)).toBe(`loading:${TRACKER_ID}`)
  })

  it('includes trackerId and nonce for tracker mode', () => {
    expect(computeSessionKey('tracker', TRACKER_ID, 0, TRACKER, null)).toBe(`${TRACKER_ID}:0`)
    expect(computeSessionKey('tracker', TRACKER_ID, 3, TRACKER, null)).toBe(`${TRACKER_ID}:3`)
  })

  it('changes when trackerId changes', () => {
    const key1 = computeSessionKey('tracker', TRACKER_ID, 0, TRACKER, null)
    const key2 = computeSessionKey('tracker', TRACKER_ID_2, 0, { ...TRACKER, id: TRACKER_ID_2 }, null)
    expect(key1).not.toBe(key2)
  })

  it('changes when nonce is bumped (same trackerId)', () => {
    const key1 = computeSessionKey('tracker', TRACKER_ID, 0, TRACKER, null)
    const key2 = computeSessionKey('tracker', TRACKER_ID, 1, TRACKER, null)
    expect(key1).not.toBe(key2)
  })

  it('includes settingsContentVersion for template mode', () => {
    expect(computeSessionKey('template', null, 0, null, 7)).toBe('template:7')
    expect(computeSessionKey('template', null, 0, null, 12)).toBe('template:12')
  })

  it('template key changes when settingsContentVersion changes', () => {
    const key1 = computeSessionKey('template', null, 0, null, 1)
    const key2 = computeSessionKey('template', null, 0, null, 2)
    expect(key1).not.toBe(key2)
  })
})
