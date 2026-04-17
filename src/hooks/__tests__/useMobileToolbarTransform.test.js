import { describe, it, expect } from 'vitest'
import { computeToolbarTransform } from '../useMobileToolbarTransform'

// Pure-function tests for the BlockNote-ported toolbar transform formula.
// See docs on the hook for the reasoning behind the math.

describe('computeToolbarTransform', () => {
  it('returns an identity transform when the keyboard is closed', () => {
    // viewport.height === layoutHeight → offsetTop = 0; no offsetLeft; scale 1.
    const viewport = { height: 800, offsetTop: 0, offsetLeft: 0, scale: 1 }
    expect(computeToolbarTransform(viewport, 800)).toBe(
      'translate(0px, 0px) scale(1)'
    )
  })

  it('translates the toolbar upward when the keyboard is open', () => {
    // Android Chrome: layout viewport = 800, visual viewport shrinks to 500 →
    // keyboard occupies 300px. offsetTop = 500 - 800 + 0 = -300.
    const viewport = { height: 500, offsetTop: 0, offsetLeft: 0, scale: 1 }
    expect(computeToolbarTransform(viewport, 800)).toBe(
      'translate(0px, -300px) scale(1)'
    )
  })

  it('accounts for visual viewport pan via offsetTop', () => {
    // User has pinch-zoomed and panned; visualViewport.offsetTop reports the pan.
    const viewport = { height: 500, offsetTop: 40, offsetLeft: 0, scale: 1 }
    expect(computeToolbarTransform(viewport, 800)).toBe(
      'translate(0px, -260px) scale(1)'
    )
  })

  it('passes offsetLeft through for horizontal pan during pinch-zoom', () => {
    const viewport = { height: 500, offsetTop: 0, offsetLeft: 25, scale: 1 }
    expect(computeToolbarTransform(viewport, 800)).toBe(
      'translate(25px, -300px) scale(1)'
    )
  })

  it('applies inverse scale so the toolbar stays physically the same size during pinch-zoom', () => {
    const viewport = { height: 500, offsetTop: 0, offsetLeft: 0, scale: 2 }
    expect(computeToolbarTransform(viewport, 800)).toBe(
      'translate(0px, -300px) scale(0.5)'
    )
  })

  it('returns an identity transform for a fully zeroed viewport (defensive)', () => {
    // Unexpected input — no NaN leakage.
    const viewport = { height: 0, offsetTop: 0, offsetLeft: 0, scale: 1 }
    expect(computeToolbarTransform(viewport, 0)).toBe(
      'translate(0px, 0px) scale(1)'
    )
  })
})
