/**
 * One page row in the sidebar tree.
 *
 * Lifted out of NavigationTree so the badge rules live in one small file instead
 * of five levels deep in a 700-line render. Two badges, deliberately different:
 *
 *   TRACKER  the user's choice — which page AI Daily reads. Accented, and it
 *            abbreviates to "T" in a narrow sidebar because the user already
 *            knows which page they picked.
 *   CATALOG  not the user's — this page is written and rewritten by the app.
 *            Muted, and NEVER abbreviated: a bare "C" tells someone who has not
 *            seen it before precisely nothing, and the default sidebar (280px)
 *            is already under the compact threshold (300px), so abbreviating
 *            would be the normal case rather than the edge one.
 */
function TreePageRow({
  page,
  sectionId,
  notebookId,
  isActive,
  compactBadges = false,
  onSelect,
  onContextMenu,
  onTouchStart,
  onTouchEnd,
  onTouchMove,
}) {
  return (
    <button
      type="button"
      role="treeitem"
      aria-current={isActive ? 'page' : undefined}
      className={`tree-node tree-node-page ${isActive ? 'active' : ''}`}
      onClick={() => onSelect?.({ notebookId, sectionId, pageId: page.id })}
      onContextMenu={onContextMenu}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchMove={onTouchMove}
    >
      <span className="tree-page-marker" aria-hidden="true" />
      <span className="tree-label sidebar-title">{page.title}</span>
      {page.isDailySource ? (
        <span
          className={`tracker-page-badge ${compactBadges ? 'compact' : ''}`}
          title="Tracker page for AI Daily"
          aria-label="Tracker page for AI Daily"
        >
          {compactBadges ? 'T' : 'TRACKER'}
        </span>
      ) : null}
      {page.libraryRole === 'topic' ? (
        <span
          className="catalog-page-badge"
          title="Written by the app from what you saved"
          aria-label="Catalog page, written by the app"
        >
          CATALOG
        </span>
      ) : null}
    </button>
  )
}

export default TreePageRow
