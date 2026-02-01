import { useRef, useState } from 'react'

function Sidebar({ trackers, activeId, onSelect, onCreate, onReorder, loading, disabled }) {
  const dragIdRef = useRef(null)
  const [overId, setOverId] = useState(null)

  const reorderList = (items, draggedId, targetId) => {
    const fromIndex = items.findIndex((item) => item.id === draggedId)
    const toIndex = items.findIndex((item) => item.id === targetId)
    if (fromIndex === -1 || toIndex === -1) return items
    const next = [...items]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    return next
  }

  const handleDragStart = (id) => (event) => {
    if (disabled || loading) return
    dragIdRef.current = id
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
  }

  const handleDragOver = (id) => (event) => {
    if (disabled || loading) return
    event.preventDefault()
    if (overId !== id) setOverId(id)
    event.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (id) => (event) => {
    if (disabled || loading) return
    event.preventDefault()
    const draggedId = dragIdRef.current || event.dataTransfer.getData('text/plain')
    if (!draggedId || draggedId === id) {
      dragIdRef.current = null
      setOverId(null)
      return
    }
    const next = reorderList(trackers, draggedId, id)
    dragIdRef.current = null
    setOverId(null)
    onReorder?.(next)
  }

  const handleDragEnd = () => {
    dragIdRef.current = null
    setOverId(null)
  }

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
              className={`sidebar-item ${tracker.id === activeId ? 'active' : ''} ${
                overId === tracker.id ? 'drag-over' : ''
              }`}
              onClick={() => onSelect(tracker.id)}
              draggable={!disabled && !loading}
              onDragStart={handleDragStart(tracker.id)}
              onDragOver={handleDragOver(tracker.id)}
              onDrop={handleDrop(tracker.id)}
              onDragEnd={handleDragEnd}
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
