import { describe, it, expect } from 'vitest'
import { computeKeyboardHeight } from '../useVirtualKeyboard'

// ─── Pure computation tests ─────────────────────────────────────────────────
// The hook's core keyboard-height formula is extracted as computeKeyboardHeight.
// These tests cover the pure function without needing a DOM or React environment.

describe('computeKeyboardHeight', () => {
  it('returns 0 when baseline is null (visualViewport unavailable / not yet focused)', () => {
    expect(computeKeyboardHeight(null, 800)).toBe(0)
  })

  it('returns 0 when baseline is undefined', () => {
    expect(computeKeyboardHeight(undefined, 800)).toBe(0)
  })

  it('returns 0 when viewport height is unchanged (keyboard not open)', () => {
    expect(computeKeyboardHeight(800, 800)).toBe(0)
  })

  it('returns 0 when delta is below threshold (browser chrome collapse ~50px)', () => {
    // 800 - 760 = 40px — browser chrome collapse, not keyboard
    expect(computeKeyboardHeight(800, 760)).toBe(0)
  })

  it('returns 0 when delta is just below threshold (99px)', () => {
    expect(computeKeyboardHeight(800, 701)).toBe(0)
  })

  it('returns correct height when keyboard opens (delta at threshold)', () => {
    // delta = 100px exactly — treated as keyboard open
    expect(computeKeyboardHeight(800, 700)).toBe(100)
  })

  it('returns correct height for typical Android keyboard (delta ~300px)', () => {
    // baseline=800, current=500, delta=300; cap = 500*0.6 = 300 (no cap needed)
    expect(computeKeyboardHeight(800, 500)).toBe(300)
  })

  it('caps at 60% of current height for extreme cases (floating keyboard, split-screen)', () => {
    // baseline=800, current=200, delta=600; uncapped=600, cap=200*0.6=120
    expect(computeKeyboardHeight(800, 200)).toBe(120)
  })

  it('cap is applied when delta exceeds 60% of current height', () => {
    // baseline=1000, current=300, delta=700; cap=300*0.6=180
    expect(computeKeyboardHeight(1000, 300)).toBe(180)
  })

  it('handles large viewport values (tablet-sized baseline)', () => {
    // baseline=1024, current=724, delta=300; cap=724*0.6=434.4 (no cap)
    expect(computeKeyboardHeight(1024, 724)).toBe(300)
  })
})
