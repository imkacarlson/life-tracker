import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorUIStore } from '../editorUIStore'

const reset = () => {
  useEditorUIStore.setState({ toolbarExpanded: false, aiDailyDate: new Date('2026-05-26T00:00:00') })
}

describe('useEditorUIStore - setToolbarExpanded', () => {
  beforeEach(reset)

  it('accepts a boolean value', () => {
    useEditorUIStore.getState().setToolbarExpanded(true)
    expect(useEditorUIStore.getState().toolbarExpanded).toBe(true)

    useEditorUIStore.getState().setToolbarExpanded(false)
    expect(useEditorUIStore.getState().toolbarExpanded).toBe(false)
  })

  it('accepts a functional updater that toggles the value', () => {
    useEditorUIStore.setState({ toolbarExpanded: false })
    useEditorUIStore.getState().setToolbarExpanded((prev) => !prev)
    expect(useEditorUIStore.getState().toolbarExpanded).toBe(true)

    useEditorUIStore.getState().setToolbarExpanded((prev) => !prev)
    expect(useEditorUIStore.getState().toolbarExpanded).toBe(false)
  })

  it('does not store the updater function itself as the state value', () => {
    useEditorUIStore.getState().setToolbarExpanded((prev) => !prev)
    expect(typeof useEditorUIStore.getState().toolbarExpanded).toBe('boolean')
  })

  it('passes the current value into the functional updater', () => {
    useEditorUIStore.setState({ toolbarExpanded: true })
    let received
    useEditorUIStore.getState().setToolbarExpanded((prev) => {
      received = prev
      return prev
    })
    expect(received).toBe(true)
  })
})

describe('useEditorUIStore - setContextMenu', () => {
  beforeEach(reset)

  it('accepts a next value object', () => {
    const next = { open: true, x: 10, y: 20, blockId: 'b1', inTable: false, misspelling: null }
    useEditorUIStore.getState().setContextMenu(next)
    expect(useEditorUIStore.getState().contextMenu).toEqual(next)
  })

  it('accepts a functional updater without storing the function', () => {
    // Regression: the repositioning effect calls setContextMenu((prev) => ({...prev, x, y})).
    // If the store stored the function itself, contextMenu.open became undefined and the
    // menu silently closed the moment it needed repositioning.
    useEditorUIStore.getState().setContextMenu({
      open: true, x: 0, y: 0, blockId: 'b1', inTable: false, misspelling: { word: 'teh', from: 1, to: 4 },
    })
    useEditorUIStore.getState().setContextMenu((prev) => ({ ...prev, x: 99, y: 42 }))

    const menu = useEditorUIStore.getState().contextMenu
    expect(typeof menu).toBe('object')
    expect(menu.open).toBe(true)
    expect(menu.x).toBe(99)
    expect(menu.y).toBe(42)
    expect(menu.misspelling).toEqual({ word: 'teh', from: 1, to: 4 })
  })
})

describe('useEditorUIStore - setAiDailyDate', () => {
  beforeEach(reset)

  it('accepts a Date value', () => {
    const next = new Date('2026-05-27T00:00:00')
    useEditorUIStore.getState().setAiDailyDate(next)
    expect(useEditorUIStore.getState().aiDailyDate).toBe(next)
  })

  it('accepts a functional updater without storing the function', () => {
    useEditorUIStore.getState().setAiDailyDate((prev) => {
      const next = new Date(prev)
      next.setDate(next.getDate() + 1)
      return next
    })

    const aiDailyDate = useEditorUIStore.getState().aiDailyDate
    expect(aiDailyDate).toBeInstanceOf(Date)
    expect(aiDailyDate.toLocaleDateString('en-CA')).toBe('2026-05-27')
  })
})
