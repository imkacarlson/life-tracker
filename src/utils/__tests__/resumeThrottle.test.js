import { describe, it, expect } from 'vitest'
import { shouldRunResume } from '../resumeThrottle'

describe('shouldRunResume', () => {
  it('runs the first time (no previous run recorded)', () => {
    expect(shouldRunResume(null, 1000, 1500)).toBe(true)
  })

  it('collapses a burst of resume signals fired within the interval', () => {
    // visibility + pageshow + online firing ~immediately after a real run.
    expect(shouldRunResume(1000, 1000, 1500)).toBe(false)
    expect(shouldRunResume(1000, 1400, 1500)).toBe(false)
  })

  it('runs again once the interval has elapsed', () => {
    expect(shouldRunResume(1000, 2500, 1500)).toBe(true)
  })

  it('runs exactly at the interval boundary', () => {
    expect(shouldRunResume(1000, 2500, 1500)).toBe(true)
    expect(shouldRunResume(1000, 2499, 1500)).toBe(false)
  })
})
