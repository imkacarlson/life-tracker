function SectionTabs({
  sections,
  activeSectionId,
  activeNotebookId,
  onSelectSection,
  onRenameSection,
  onDeleteSection,
  onOpenContextMenu,
  onCreateSection,
}) {
  return (
    <div className="section-tabs">
      {sections.map((section) => (
        <div
          key={section.id}
          role="button"
          tabIndex={0}
          className={`section-tab ${section.id === activeSectionId ? 'active' : ''}`}
          style={{ backgroundColor: section.color || '#eef2ff' }}
          onClick={() => onSelectSection(section.id)}
          onDoubleClick={() => onRenameSection(section)}
          onContextMenu={(event) => onOpenContextMenu(event, section)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onSelectSection(section.id)
            }
          }}
        >
          <span>{section.title}</span>
          <button
            type="button"
            className="tab-delete"
            onClick={(event) => {
              event.stopPropagation()
              onDeleteSection(section)
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button className="section-add" onClick={onCreateSection} disabled={!activeNotebookId}>
        +
      </button>
    </div>
  )
}

export default SectionTabs
