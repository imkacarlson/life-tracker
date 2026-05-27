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
