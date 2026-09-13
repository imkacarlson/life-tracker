import { describe, it, expect } from 'vitest'
import { shouldDockToolbar, DOCK_TOLERANCE_PX } from '../toolbarDock'

// The desktop toolbar sits in a `position: sticky` dock inside the editor
// panel's scrollport. It renders as a floating card at rest and as pinned app
// chrome once the user scrolls far enough that the dock settles level with the
// scrollport's top edge.
//
// Inputs (all viewport-coordinate numbers; the caller owns the DOM reads):
//   scrollTop — the editor panel's current scroll offset
//   dockTop   — y of the dock's top edge
//   panelTop  — y of the scrollport's top edge
//   tolerance — sub-pixel slack at the threshold

describe('shouldDockToolbar', () => {
  it('does not dock at rest, even when the dock already sits at the panel top', () => {
    // Before any scrolling the dock is naturally flush with the scrollport, so
    // geometry alone would say "docked". Short pages must stay a floating card.
    expect(
      shouldDockToolbar({ scrollTop: 0, dockTop: 100, panelTop: 100 }),
    ).toBe(false)
  })

  it('does not dock while the dock is still below the panel top', () => {
    expect(
      shouldDockToolbar({ scrollTop: 40, dockTop: 150, panelTop: 100 }),
    ).toBe(false)
  })

  it('docks once the dock reaches the panel top', () => {
    expect(
      shouldDockToolbar({ scrollTop: 200, dockTop: 100, panelTop: 100 }),
    ).toBe(true)
  })

  it('docks when sticky has carried the dock above the panel top', () => {
    // `top: -1rem` lets the dock ride slightly above the scrollport edge.
    expect(
      shouldDockToolbar({ scrollTop: 400, dockTop: 84, panelTop: 100 }),
    ).toBe(true)
  })

  it('absorbs sub-pixel rounding within the tolerance', () => {
    // Fractional devicePixelRatio (e.g. 1.75) leaves the two rects a sliver
    // apart at the exact threshold; that must still read as docked.
    expect(
      shouldDockToolbar({ scrollTop: 200, dockTop: 100.6, panelTop: 100 }),
    ).toBe(true)
    expect(DOCK_TOLERANCE_PX).toBe(1)
  })

  it('does not dock just outside the tolerance', () => {
    expect(
      shouldDockToolbar({ scrollTop: 200, dockTop: 101.5, panelTop: 100 }),
    ).toBe(false)
  })

  it('honours an explicit tolerance', () => {
    expect(
      shouldDockToolbar({
        scrollTop: 200,
        dockTop: 104,
        panelTop: 100,
        tolerance: 5,
      }),
    ).toBe(true)
  })

  it('returns false for non-finite measurements', () => {
    // A detached or display:none panel reports NaN rects; never toggle on that.
    expect(
      shouldDockToolbar({ scrollTop: NaN, dockTop: 100, panelTop: 100 }),
    ).toBe(false)
    expect(
      shouldDockToolbar({ scrollTop: 200, dockTop: NaN, panelTop: 100 }),
    ).toBe(false)
    expect(
      shouldDockToolbar({ scrollTop: 200, dockTop: 100, panelTop: undefined }),
    ).toBe(false)
  })
})
