function TreeContextMenu({ menu, onRename, onDelete, onCopy, onMove }) {
  if (!menu.open || !menu.item) return null

  const isNotebook = menu.type === 'notebook'
  const isSection = menu.type === 'section'
  const isPage = menu.type === 'page'

  return (
    <div className="tree-context-menu" style={{ top: menu.y, left: menu.x }}>
      {(isNotebook || isSection) ? (
        <button type="button" className="tree-context-item" onClick={onRename}>
          Rename
        </button>
      ) : null}
      {isSection ? (
        <button type="button" className="tree-context-item" onClick={onCopy}>
          Copy to…
        </button>
      ) : null}
      {isSection ? (
        <button type="button" className="tree-context-item" onClick={onMove}>
          Move to…
        </button>
      ) : null}
      {(isNotebook || isSection || isPage) ? (
        <button type="button" className="tree-context-item danger" onClick={onDelete}>
          Delete
        </button>
      ) : null}
    </div>
  )
}

export default TreeContextMenu
