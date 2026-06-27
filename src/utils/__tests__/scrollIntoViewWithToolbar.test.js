import { describe, it, expect } from 'vitest'
import {
  computeScrollAdjustment,
  getToolbarSafeBounds,
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

  // align: 'center' — used by find navigation so each Prev/Next lands the
  // match in the vertical middle of the safe band, regardless of focus.
  describe("align: 'center'", () => {
    it('returns a negative delta that centers a match above the band center', () => {
      // rect center = (60 + 80) / 2 = 70; band center = (100 + 700) / 2 = 400.
      // delta = 70 - 400 = -330 → scroll up so the match rises to the center.
      expect(
        computeScrollAdjustment({
          cursorTop: 60,
          cursorBottom: 80,
          safeTop: 100,
          safeBottom: 700,
          padding: 16,
          align: 'center',
        }),
      ).toBe(-330)
    })

    it('returns a positive delta that centers a match below the band center', () => {
      // rect center = (780 + 800) / 2 = 790; band center = 400.
      // delta = 790 - 400 = 390 → scroll down so the match drops to the center.
      expect(
        computeScrollAdjustment({
          cursorTop: 780,
          cursorBottom: 800,
          safeTop: 100,
          safeBottom: 700,
          padding: 16,
          align: 'center',
        }),
      ).toBe(390)
    })

    it('returns ~0 when the match is already centered', () => {
      // rect center = (390 + 410) / 2 = 400; band center = 400 → no scroll.
      expect(
        computeScrollAdjustment({
          cursorTop: 390,
          cursorBottom: 410,
          safeTop: 100,
          safeBottom: 700,
          padding: 16,
          align: 'center',
        }),
      ).toBe(0)
    })

    it('ignores padding for centering (band center is padding-independent)', () => {
      const withPadding = computeScrollAdjustment({
        cursorTop: 60,
        cursorBottom: 80,
        safeTop: 100,
        safeBottom: 700,
        padding: 40,
        align: 'center',
      })
      const withoutPadding = computeScrollAdjustment({
        cursorTop: 60,
        cursorBottom: 80,
        safeTop: 100,
        safeBottom: 700,
        align: 'center',
      })
      expect(withPadding).toBe(withoutPadding)
      expect(withPadding).toBe(-330)
    })
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

describe('getToolbarSafeBounds', () => {
  it('lowers safeBottom to the toolbar top for a bottom toolbar (mobile)', () => {
    // Toolbar sits in the lower half of the surface → obstructs the bottom.
    const toolbarEl = {
      getBoundingClientRect: () => ({ top: 720, bottom: 852, height: 132 }),
    }

    expect(
      getToolbarSafeBounds({ surfaceTop: 0, surfaceBottom: 852, toolbarEl }),
    ).toEqual({ safeTop: 0, safeBottom: 720 })
  })

  it('raises safeTop to the toolbar bottom for a top toolbar (desktop sticky)', () => {
    // Toolbar sits in the upper half of the surface → obstructs the top.
    const toolbarEl = {
      getBoundingClientRect: () => ({ top: 0, bottom: 48, height: 48 }),
    }

    expect(
      getToolbarSafeBounds({ surfaceTop: 0, surfaceBottom: 900, toolbarEl }),
    ).toEqual({ safeTop: 48, safeBottom: 900 })
  })

  it('leaves the band untouched when there is no toolbar', () => {
    expect(
      getToolbarSafeBounds({ surfaceTop: 10, surfaceBottom: 800, toolbarEl: null }),
    ).toEqual({ safeTop: 10, safeBottom: 800 })
  })

  it('ignores a zero-height toolbar', () => {
    const toolbarEl = {
      getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0 }),
    }
    expect(
      getToolbarSafeBounds({ surfaceTop: 0, surfaceBottom: 800, toolbarEl }),
    ).toEqual({ safeTop: 0, safeBottom: 800 })
  })

  it('ignores a toolbar entirely below the surface', () => {
    const toolbarEl = {
      getBoundingClientRect: () => ({ top: 900, bottom: 1030, height: 130 }),
    }
    expect(
      getToolbarSafeBounds({ surfaceTop: 0, surfaceBottom: 852, toolbarEl }),
    ).toEqual({ safeTop: 0, safeBottom: 852 })
  })

  it('ignores a toolbar entirely above the surface', () => {
    const toolbarEl = {
      getBoundingClientRect: () => ({ top: -130, bottom: -10, height: 120 }),
    }
    expect(
      getToolbarSafeBounds({ surfaceTop: 0, surfaceBottom: 852, toolbarEl }),
    ).toEqual({ safeTop: 0, safeBottom: 852 })
  })
})

describe('scrollRectIntoViewWithToolbar', () => {
  it('scrolls a rect above a bottom toolbar (mobile)', () => {
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

  it('scrolls a rect down below a sticky top toolbar (desktop)', () => {
    const originalWindow = globalThis.window
    const scrollCalls = []
    globalThis.window = {
      innerHeight: 900,
      scrollBy: (opts) => scrollCalls.push(opts),
    }

    try {
      // Desktop: sticky toolbar at the top of the surface. A match tucked just
      // under it must scroll *down* (negative delta) to clear the toolbar.
      const toolbarEl = {
        getBoundingClientRect: () => ({ top: 0, bottom: 48, height: 48 }),
      }
      const delta = scrollRectIntoViewWithToolbar({
        rect: { top: 50, bottom: 70 },
        toolbarEl,
        padding: 20,
      })

      // safeTop = 48; topEdge = 48 + 20 = 68; cursorTop 50 < 68 → delta 50 - 68 = -18
      expect(delta).toBe(-18)
      expect(scrollCalls).toEqual([{ top: -18, behavior: 'instant' }])
    } finally {
      globalThis.window = originalWindow
    }
  })

  it('uses the visual viewport band (offset + height) for the window surface', () => {
    const originalWindow = globalThis.window
    const scrollCalls = []
    // Keyboard open: layout innerHeight is still 852, but the visual viewport
    // has shrunk to height 560 starting at offsetTop 0. The bottom toolbar sits
    // at the top of the keyboard. The surface must follow the visual viewport,
    // not innerHeight, so the toolbar lands in the lower half and is treated as
    // a bottom obstruction.
    globalThis.window = {
      innerHeight: 852,
      visualViewport: { offsetTop: 0, height: 560 },
      scrollBy: (opts) => scrollCalls.push(opts),
    }

    try {
      const toolbarEl = {
        getBoundingClientRect: () => ({ top: 480, bottom: 560, height: 80 }),
      }
      // Caret tucked behind the toolbar (top 500 > safeBottom-padding).
      const delta = scrollRectIntoViewWithToolbar({
        rect: { top: 500, bottom: 520 },
        toolbarEl,
        padding: 16,
      })

      // surfaceBottom = 0 + 560 = 560; safeBottom = toolbar top 480;
      // bottomEdge = 480 - 16 = 464; cursorBottom 520 > 464 → delta 520 - 464 = 56
      expect(delta).toBe(56)
      expect(scrollCalls).toEqual([{ top: 56, behavior: 'instant' }])
    } finally {
      globalThis.window = originalWindow
    }
  })

  it('honors visualViewport offsetTop (pinch-zoom pan) as the surface top', () => {
    const originalWindow = globalThis.window
    const scrollCalls = []
    globalThis.window = {
      innerHeight: 852,
      visualViewport: { offsetTop: 100, height: 600 },
      scrollBy: (opts) => scrollCalls.push(opts),
    }

    try {
      // No toolbar; a caret above the panned-in top edge (offsetTop 100) must
      // scroll up into view.
      const delta = scrollRectIntoViewWithToolbar({
        rect: { top: 90, bottom: 110 },
        toolbarEl: null,
        padding: 16,
      })

      // safeTop = 100; topEdge = 116; cursorTop 90 < 116 → delta 90 - 116 = -26
      expect(delta).toBe(-26)
      expect(scrollCalls).toEqual([{ top: -26, behavior: 'instant' }])
    } finally {
      globalThis.window = originalWindow
    }
  })

  it('falls back to innerHeight when visualViewport is absent', () => {
    const originalWindow = globalThis.window
    const scrollCalls = []
    // No visualViewport on the mock → desktop / existing-test path.
    globalThis.window = {
      innerHeight: 900,
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

      // surfaceBottom = innerHeight 900; safeBottom = 720; bottomEdge = 700;
      // cursorBottom 807 > 700 → delta 107
      expect(delta).toBe(107)
      expect(scrollCalls).toEqual([{ top: 107, behavior: 'instant' }])
    } finally {
      globalThis.window = originalWindow
    }
  })

  it('is a no-op when the target is already comfortably visible', () => {
    const originalWindow = globalThis.window
    const scrollCalls = []
    globalThis.window = {
      innerHeight: 900,
      scrollBy: (opts) => scrollCalls.push(opts),
    }

    try {
      const toolbarEl = {
        getBoundingClientRect: () => ({ top: 0, bottom: 48, height: 48 }),
      }
      const delta = scrollRectIntoViewWithToolbar({
        rect: { top: 400, bottom: 420 },
        toolbarEl,
        padding: 20,
      })

      expect(delta).toBe(0)
      expect(scrollCalls).toEqual([])
    } finally {
      globalThis.window = originalWindow
    }
  })
})
