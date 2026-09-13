// Pure geometry for the desktop toolbar dock. It lives outside the hook so it
// can be unit-tested with plain numbers — the same boundary as
// computeToolbarTransform (useMobileToolbarTransform.js) and
// getToolbarSafeBounds (scrollIntoViewWithToolbar.js).

// The dock is `position: sticky`, so once the panel has scrolled far enough
// the dock stops moving and settles level with the scrollport's top edge. The
// tolerance absorbs sub-pixel rounding on fractional device pixel ratios,
// where the two rects can land a fraction apart at the exact threshold.
export const DOCK_TOLERANCE_PX = 1

/**
 * Should the toolbar render as pinned app chrome rather than a floating card?
 *
 * Takes plain numbers (not elements) so the caller owns all DOM reads.
 */
export function shouldDockToolbar({
  scrollTop,
  dockTop,
  panelTop,
  tolerance = DOCK_TOLERANCE_PX,
}) {
  if (
    !Number.isFinite(scrollTop) ||
    !Number.isFinite(dockTop) ||
    !Number.isFinite(panelTop)
  ) {
    return false
  }

  // At rest the toolbar is a floating card; it only becomes chrome once the
  // user has actually scrolled. Without this, a panel whose content is shorter
  // than the scrollport would dock immediately.
  if (scrollTop <= 0) return false

  return dockTop <= panelTop + tolerance
}
