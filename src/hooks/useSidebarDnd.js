import { useCallback, useRef, useState } from 'react'
import {
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { getLibraryTreeShape } from '../utils/libraryTree'
import { getVisibleSectionPages } from '../utils/sectionPages'
import { canReorder, reorderById, reindexSortOrder } from '../utils/sidebarReorder'

const VERTICAL_KEYBOARD_DIRECTIONS = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
}

/**
 * The sections a notebook lets you drag, in the order they are rendered.
 *
 * Computed independently of NavigationTree, so it has to apply the same Library
 * suppression: a Library's home section has no row, and if it stayed in this
 * group then reindexSortOrder would rewrite its sort_order from a gesture aimed
 * at two rows the user can actually see.
 */
function draggableSections(notebookId, { notebooks, sections, sectionPageCache }) {
  const inNotebook = (sections ?? []).filter((section) => section.notebook_id === notebookId)
  const notebook = (notebooks ?? []).find((item) => item.id === notebookId)
  if (notebook?.type !== 'library') return inNotebook
  return getLibraryTreeShape(inNotebook, sectionPageCache).sections
}

function getCurrentCoordinates(context, currentCoordinates) {
  if (currentCoordinates) return currentCoordinates
  const collisionRect = context.collisionRect
  return collisionRect ? { x: collisionRect.left, y: collisionRect.top } : undefined
}

function treeKeyboardCoordinates(event, { context, currentCoordinates }, onKeyboardMove) {
  const direction = VERTICAL_KEYBOARD_DIRECTIONS[event.code]
  if (!direction) return undefined

  event.preventDefault()

  const activeId = context.active?.id
  const activeData = context.active?.data?.current
  if (activeId && activeData && onKeyboardMove?.(activeId, activeData, direction)) {
    return getCurrentCoordinates(context, currentCoordinates)
  }

  const items = context.active?.data?.current?.sortable?.items
  if (!activeId || !Array.isArray(items)) return undefined

  const activeIndex = items.indexOf(activeId)
  const nextId = items[activeIndex + direction]
  if (!nextId) return undefined

  const nextRect = context.droppableRects.get(nextId)
  if (!nextRect) return undefined

  return {
    x: nextRect.left,
    y: nextRect.top,
  }
}

/**
 * Owns the @dnd-kit wiring for the sidebar tree: sensors, the active-row state
 * used to render the drag overlay, and the drag start/end handlers.
 *
 * onDragEnd reads the dragged/target `data` payloads, enforces "reorder within
 * the same parent only" via canReorder, computes the reordered sibling group
 * with reorderById, and dispatches to the matching reorder callback.
 *
 * @param {object} params
 * @param {Array} params.notebooks
 * @param {Array} params.sections - the global sections array (all notebooks)
 * @param {object} params.sectionPageCache
 * @param {(next: Array) => void} params.onReorderNotebooks
 * @param {(notebookId: string, next: Array) => void} params.onReorderSections
 * @param {(sectionId: string, next: Array) => void} params.onReorderPages
 */
export function useSidebarDnd({
  notebooks,
  sections,
  sectionPageCache,
  onReorderNotebooks,
  onReorderSections,
  onReorderPages,
}) {
  // The row currently being dragged — { id, type, label } — for the DragOverlay.
  const [activeItem, setActiveItem] = useState(null)
  const lastDragOverReorderRef = useRef(null)
  const latestRef = useRef({
    notebooks,
    sections,
    sectionPageCache,
    onReorderNotebooks,
    onReorderSections,
    onReorderPages,
  })
  // eslint-disable-next-line react-hooks/refs -- latest-value ref so dnd-kit handlers avoid stale closures
  latestRef.current = {
    notebooks,
    sections,
    sectionPageCache,
    onReorderNotebooks,
    onReorderSections,
    onReorderPages,
  }

  const onDragStart = useCallback((event) => {
    lastDragOverReorderRef.current = null
    const data = event.active?.data?.current
    if (!data) return
    setActiveItem({ id: event.active.id, type: data.type, label: data.label ?? '' })
  }, [])

  const reorderFromDragEvent = useCallback(
    (event) => {
      const { active, over } = event
      if (!over || active.id === over.id) return false

      const activeData = active.data?.current
      const overData = over.data?.current
      if (!canReorder(activeData, overData)) return false

      if (activeData.type === 'notebook') {
        const next = reorderById(notebooks, active.id, over.id)
        if (next !== notebooks) onReorderNotebooks?.(next)
        return next !== notebooks
      }

      if (activeData.type === 'section') {
        const notebookId = activeData.parentId
        const group = draggableSections(notebookId, { notebooks, sections, sectionPageCache })
        const next = reorderById(group, active.id, over.id)
        if (next !== group) onReorderSections?.(notebookId, next)
        return next !== group
      }

      if (activeData.type === 'page') {
        const sectionId = activeData.parentId
        // Same visible list the tree renders, so a drop index never drifts.
        const group = getVisibleSectionPages(sectionPageCache, sectionId)
        const next = reorderById(group, active.id, over.id)
        if (next !== group) onReorderPages?.(sectionId, next)
        return next !== group
      }

      return false
    },
    [notebooks, sections, sectionPageCache, onReorderNotebooks, onReorderSections, onReorderPages],
  )

  const reorderKeyboardItem = useCallback(
    (id, data, direction) => {
      if (!id || !data || !direction) return false
      const latest = latestRef.current

      if (data.type === 'notebook') {
        const index = latest.notebooks.findIndex((item) => item.id === id)
        const over = latest.notebooks[index + direction]
        if (!over) return false
        const next = reindexSortOrder(reorderById(latest.notebooks, id, over.id))
        if (next !== latest.notebooks) latest.onReorderNotebooks?.(next)
        return next !== latest.notebooks
      }

      if (data.type === 'section') {
        const notebookId = data.parentId
        const group = draggableSections(notebookId, latest)
        const index = group.findIndex((item) => item.id === id)
        const over = group[index + direction]
        if (!over) return false
        const next = reindexSortOrder(reorderById(group, id, over.id))
        if (next !== group) latest.onReorderSections?.(notebookId, next)
        return next !== group
      }

      if (data.type === 'page') {
        const sectionId = data.parentId
        const group = getVisibleSectionPages(latest.sectionPageCache, sectionId)
        const index = group.findIndex((item) => item.id === id)
        const over = group[index + direction]
        if (!over) return false
        const next = reindexSortOrder(reorderById(group, id, over.id))
        if (next !== group) latest.onReorderPages?.(sectionId, next)
        return next !== group
      }

      return false
    },
    [],
  )

  const keyboardCoordinateGetter = useCallback(
    (event, args) => treeKeyboardCoordinates(event, args, reorderKeyboardItem),
    [reorderKeyboardItem],
  )

  const sensors = useSensors(
    // PointerSensor covers mouse + touch via pointer events. A small activation
    // distance prevents an accidental tap/scroll from starting a drag.
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: keyboardCoordinateGetter,
    }),
  )

  const onDragOver = useCallback(
    (event) => {
      if (!event.over || event.active.id === event.over.id) return

      // Keyboard sorting in nested, variable-height rows is more stable when
      // the list reorders as the active item moves over each sibling.
      const reorderKey = `${event.active.id}:${event.over.id}`
      if (lastDragOverReorderRef.current === reorderKey) return
      if (reorderFromDragEvent(event)) {
        lastDragOverReorderRef.current = reorderKey
      }
    },
    [reorderFromDragEvent],
  )

  const onDragEnd = useCallback(
    (event) => {
      setActiveItem(null)
      const reorderKey = event.over ? `${event.active.id}:${event.over.id}` : null
      if (reorderKey && lastDragOverReorderRef.current === reorderKey) {
        lastDragOverReorderRef.current = null
        return
      }
      lastDragOverReorderRef.current = null
      reorderFromDragEvent(event)
    },
    [reorderFromDragEvent],
  )

  const onDragCancel = useCallback(() => {
    lastDragOverReorderRef.current = null
    setActiveItem(null)
  }, [])

  return {
    sensors,
    activeItem,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDragCancel,
    onKeyboardMove: reorderKeyboardItem,
  }
}
