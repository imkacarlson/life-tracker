function Sidebar({ trackers, activeId, onSelect, onCreate, loading, disabled }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>Pages</h2>
        <button className="secondary" onClick={onCreate} disabled={disabled}>
          New
        </button>
      </div>

      {loading ? (
        <p className="subtle">Loading pages...</p>
      ) : disabled ? (
        <p className="subtle">Select a section to view pages.</p>
      ) : trackers.length === 0 ? (
        <p className="subtle">No pages yet.</p>
      ) : (
        <div className="sidebar-list">
          {trackers.map((tracker) => (
            <button
              key={tracker.id}
              className={`sidebar-item ${tracker.id === activeId ? 'active' : ''}`}
              onClick={() => onSelect(tracker.id)}
            >
              <span className="sidebar-title">{tracker.title}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  )
}

export default Sidebar
