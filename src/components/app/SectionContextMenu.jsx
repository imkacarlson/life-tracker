function SectionContextMenu({ menu, onRename, onCopy, onMove }) {
  if (!menu.open) return null

  return (
    <div className="section-context-menu" style={{ top: menu.y, left: menu.x }}>
      <button type="button" className="section-context-item" onClick={onRename}>
        Rename
      </button>
      <button type="button" className="section-context-item" onClick={onCopy}>
        Copy to…
      </button>
      <button type="button" className="section-context-item" onClick={onMove}>
        Move to…
      </button>
    </div>
  )
}

export default SectionContextMenu
