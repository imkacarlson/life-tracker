import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

/**
 * Wraps a single sidebar row (notebook/section/page) so it can be reordered via
 * @dnd-kit. Drag is initiated from a dedicated grip handle — NOT the whole row —
 * so the row body keeps its existing tap-to-select and long-press-context-menu
 * gestures, and a vertical swipe still scrolls the sidebar.
 *
 * The row's children (the existing button markup) are passed through unchanged
 * so current behavior is preserved.
 *
 * @param {object} props
 * @param {string} props.id - unique id of this row (matches the SortableContext item id)
 * @param {{ type: string, parentId: string|null }} props.data - dnd grouping data
 * @param {string} [props.className] - extra class names for the row wrapper
 * @param {string} [props.handleLabel] - aria-label for the drag handle
 * @param {boolean} [props.disabled] - disable dragging for this row
 * @param {(direction: -1|1) => boolean} [props.onKeyboardMove] - direct keyboard reorder
 * @param {React.ReactNode} props.children
 */
function SortableTreeRow({
  id,
  data,
  className = '',
  handleLabel = 'Drag to reorder',
  disabled = false,
  onKeyboardMove,
  children,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, data, disabled })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const rowClassName = ['tree-sortable-row', className, isDragging ? 'dragging' : '']
    .filter(Boolean)
    .join(' ')
  const { onKeyDown, ...listenerProps } = listeners ?? {}

  const handleKeyDown = (event) => {
    const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight'
      ? 1
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
        ? -1
        : 0

    if (direction && onKeyboardMove?.(direction)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }

    onKeyDown?.(event)
  }

  return (
    <div ref={setNodeRef} style={style} className={rowClassName}>
      <button
        type="button"
        className="tree-drag-handle"
        aria-label={handleLabel}
        // Stop the click from bubbling to the row's select handler.
        onClick={(event) => event.stopPropagation()}
        {...attributes}
        {...listenerProps}
        onKeyDown={handleKeyDown}
      >
        <GripIcon />
      </button>
      {children}
    </div>
  )
}

function GripIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="7" cy="5" r="1.4" fill="currentColor" />
      <circle cx="13" cy="5" r="1.4" fill="currentColor" />
      <circle cx="7" cy="10" r="1.4" fill="currentColor" />
      <circle cx="13" cy="10" r="1.4" fill="currentColor" />
      <circle cx="7" cy="15" r="1.4" fill="currentColor" />
      <circle cx="13" cy="15" r="1.4" fill="currentColor" />
    </svg>
  )
}

export default SortableTreeRow
