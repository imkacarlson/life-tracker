import { describe, it, expect } from 'vitest'
import { computeKeyboardHeight, updateBaseline } from '../useVirtualKeyboard'

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

// ─── updateBaseline tests ──────────────────────────────────────────────────────
// updateBaseline implements "self-correcting baseline": when the viewport grows
// (URL bar hides) BEFORE the keyboard opens, the baseline must track upward so
// that keyboard height is computed against the true full-screen height.
//
// Bug without this: baseline captured when URL bar is visible (H - 56px).
// Keyboard opens after URL bar hides → delta = keyboard - 56 px instead of
// keyboard → toolbar is lifted 56 px too low → keyboard overlaps toolbar.

describe('updateBaseline', () => {
  it('returns null unchanged when baseline has not yet been captured', () => {
    // null = focusin has not fired yet; nothing to update
    expect(updateBaseline(null, 800)).toBeNull()
  })

  it('returns baseline unchanged when viewport height equals baseline (no change)', () => {
    expect(updateBaseline(800, 800)).toBe(800)
  })

  it('returns baseline unchanged when viewport height shrinks (keyboard opening)', () => {
    // viewport shrinking means keyboard is opening — baseline must NOT follow down
    expect(updateBaseline(800, 500)).toBe(800)
  })

  it('updates baseline when viewport grows (URL bar hides before keyboard opens)', () => {
    // URL bar hides → vv.height grows from 744 to 800; baseline must track up
    // so keyboard height is computed from the full-screen 800 reference
    expect(updateBaseline(744, 800)).toBe(800)
  })

  it('updates baseline for any viewport growth, not just URL-bar-sized jumps', () => {
    expect(updateBaseline(700, 750)).toBe(750)
  })

  it('does not update baseline when viewport shrinks by less than threshold', () => {
    // A 40px shrink is browser chrome collapse, not a keyboard — baseline stays
    expect(updateBaseline(800, 760)).toBe(800)
  })
})
