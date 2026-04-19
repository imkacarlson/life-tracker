import { describe, it, expect } from 'vitest'
import { computeScrollDelta } from '../cursorVisibility'

describe('computeScrollDelta', () => {
  it('returns 0 when cursor bottom is above the safe zone', () => {
    expect(computeScrollDelta({ cursorBottom: 300, safeBottom: 400 })).toBe(0)
  })

  it('returns 0 when cursor bottom is exactly at the safe zone boundary', () => {
    expect(computeScrollDelta({ cursorBottom: 400, safeBottom: 400 })).toBe(0)
  })

  it('returns the overlap amount when cursor extends below the safe zone', () => {
    expect(computeScrollDelta({ cursorBottom: 450, safeBottom: 400 })).toBe(50)
  })

  it('returns correct delta for large overlap', () => {
    expect(computeScrollDelta({ cursorBottom: 600, safeBottom: 400 })).toBe(200)
  })

  it('handles fractional pixel values', () => {
    expect(computeScrollDelta({ cursorBottom: 400.5, safeBottom: 400 })).toBeCloseTo(0.5)
  })

  it('returns 0 when cursor bottom is 0 and safe zone is positive', () => {
    expect(computeScrollDelta({ cursorBottom: 0, safeBottom: 400 })).toBe(0)
  })

  it('returns 0 when both values are equal at 0', () => {
    expect(computeScrollDelta({ cursorBottom: 0, safeBottom: 0 })).toBe(0)
  })
})
