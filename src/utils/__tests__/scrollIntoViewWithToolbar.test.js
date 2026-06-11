import { describe, it, expect } from 'vitest'
import {
  computeScrollAdjustment,
  getToolbarSafeBottom,
  scrollRectIntoViewWithToolbar,
} from '../scrollIntoViewWithToolbar'

// Bidirectional scroll math used to keep the cursor in the visible band
// between the top of a scroll surface and a bottom obstruction such as the
// mobile toolbar's top edge,
// minus a padding so we don't sit flush against either edge.
//
// Inputs:
//   cursorTop, cursorBottom — cursor rect in viewport (or container) coordinates
//   safeTop                 — y of the visible area's top edge
//   safeBottom              — y of the visible area's bottom edge
//   padding                 — extra breathing room from each edge
//
// Returns a signed delta to feed scrollBy:
//   positive → scroll down (cursor is below safe zone — bring it up into view)
//   negative → scroll up   (cursor is above safe zone — bring it down into view)
//   0        → cursor is inside the safe zone
describe('computeScrollAdjustment', () => {
  it('returns 0 when the cursor is comfortably inside the safe zone', () => {
    expect(
      computeScrollAdjustment({
        cursorTop: 300,
        cursorBottom: 320,
        safeTop: 100,
        safeBottom: 700,
        padding: 16,
      }),
    ).toBe(0)
  })

  it('returns a positive delta when the cursor is below the safe zone', () => {
    // cursorBottom 800; safeBottom - padding = 700 - 16 = 684 → scroll down 116
    expect(
      computeScrollAdjustment({
        cursorTop: 780,
        cursorBottom: 800,
        safeTop: 100,
        safeBottom: 700,
        padding: 16,
      }),
    ).toBe(116)
  })

  it('returns a negative delta when the cursor is above the safe zone (hidden by toolbar)', () => {
    // cursorTop 60; safeTop + padding = 100 + 16 = 116 → scroll up 56
    expect(
      computeScrollAdjustment({
        cursorTop: 60,
        cursorBottom: 80,
        safeTop: 100,
        safeBottom: 700,
        padding: 16,
      }),
    ).toBe(-56)
  })

  it('returns 0 when cursor sits exactly at the safe zone edges', () => {
    expect(
      computeScrollAdjustment({
        cursorTop: 116,
        cursorBottom: 684,
        safeTop: 100,
        safeBottom: 700,
        padding: 16,
      }),
    ).toBe(0)
  })

  it('defaults padding to 0 when omitted', () => {
    expect(
      computeScrollAdjustment({
        cursorTop: 90,
        cursorBottom: 110,
        safeTop: 100,
        safeBottom: 700,
      }),
    ).toBe(-10)
  })

  it('prefers the "above" branch when the cursor is taller than the safe zone (degenerate viewport)', () => {
    // Very narrow safe zone; both checks could fire. Above-branch wins so we
    // scroll up to expose the start of the selection.
    const delta = computeScrollAdjustment({
      cursorTop: 50,
      cursorBottom: 800,
      safeTop: 100,
      safeBottom: 700,
      padding: 16,
    })
    expect(delta).toBeLessThan(0)
  })
})

describe('getToolbarSafeBottom', () => {
  it('uses the toolbar top when the toolbar overlaps the scroll surface bottom', () => {
    const toolbarEl = {
      getBoundingClientRect: () => ({ top: 720, bottom: 852, height: 132 }),
    }

    expect(getToolbarSafeBottom({ surfaceBottom: 852, toolbarEl, padding: 16 })).toBe(720)
  })

  it('ignores a toolbar that is outside the scroll surface', () => {
    const toolbarEl = {
      getBoundingClientRect: () => ({ top: 900, bottom: 1030, height: 130 }),
    }

    expect(getToolbarSafeBottom({ surfaceBottom: 852, toolbarEl, padding: 16 })).toBe(852)
  })
})

describe('scrollRectIntoViewWithToolbar', () => {
  it('scrolls a rect above a bottom toolbar', () => {
    const originalWindow = globalThis.window
    const scrollCalls = []
    globalThis.window = {
      innerHeight: 852,
      scrollBy: (opts) => scrollCalls.push(opts),
    }

    try {
      const toolbarEl = {
        getBoundingClientRect: () => ({ top: 720, bottom: 852, height: 132 }),
      }
      const delta = scrollRectIntoViewWithToolbar({
        rect: { top: 762, bottom: 807 },
        toolbarEl,
        padding: 20,
      })

      expect(delta).toBe(107)
      expect(scrollCalls).toEqual([{ top: 107, behavior: 'instant' }])
    } finally {
      globalThis.window = originalWindow
    }
  })
})
