function Sidebar({ trackers, activeId, onSelect, onCreate, loading }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>Trackers</h2>
        <button className="secondary" onClick={onCreate}>
          New
        </button>
      </div>

      {loading ? (
        <p className="subtle">Loading trackers...</p>
      ) : trackers.length === 0 ? (
        <p className="subtle">No trackers yet.</p>
      ) : (
        <div className="sidebar-list">
          {trackers.map((tracker) => (
            <button
              key={tracker.id}
              className={`sidebar-item ${tracker.id === activeId ? 'active' : ''}`}
              onClick={() => onSelect(tracker.id)}
            >
              <span className="sidebar-title">{tracker.title}</span>
              {tracker.updated_at && (
                <span className="sidebar-date">
                  {new Date(tracker.updated_at).toLocaleDateString()}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </aside>
  )
}

export default Sidebar
