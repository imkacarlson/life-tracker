import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useNavigationSelectionStore } from '../navigationSelectionStore'

const getSelection = () => {
  const state = useNavigationSelectionStore.getState()
  return {
    activeNotebookId: state.activeNotebookId,
    activeSectionId: state.activeSectionId,
    activeTrackerId: state.activeTrackerId,
  }
}

describe('useNavigationSelectionStore', () => {
  beforeEach(() => {
    useNavigationSelectionStore.getState().clearSelection()
  })

  it('commits a complete page hierarchy atomically', () => {
    useNavigationSelectionStore.getState().selectTracker('nb-1', 'sec-1', 'pg-1')

    expect(getSelection()).toEqual({
      activeNotebookId: 'nb-1',
      activeSectionId: 'sec-1',
      activeTrackerId: 'pg-1',
    })
  })

  it('clears incompatible descendants when an ancestor is selected', () => {
    const store = useNavigationSelectionStore.getState()
    store.selectTracker('nb-1', 'sec-1', 'pg-1')

    store.selectSection('nb-2', 'sec-2')
    expect(getSelection()).toEqual({
      activeNotebookId: 'nb-2',
      activeSectionId: 'sec-2',
      activeTrackerId: null,
    })

    store.selectNotebook('nb-3')
    expect(getSelection()).toEqual({
      activeNotebookId: 'nb-3',
      activeSectionId: null,
      activeTrackerId: null,
    })
  })

  it('never retains descendants without their required ancestors', () => {
    const store = useNavigationSelectionStore.getState()

    store.selectTracker(null, 'sec-1', 'pg-1')
    expect(getSelection()).toEqual({
      activeNotebookId: null,
      activeSectionId: null,
      activeTrackerId: null,
    })

    store.selectTracker('nb-1', null, 'pg-1')
    expect(getSelection()).toEqual({
      activeNotebookId: 'nb-1',
      activeSectionId: null,
      activeTrackerId: null,
    })
  })

  it('supports page and section fallback transitions after deletion', () => {
    const store = useNavigationSelectionStore.getState()
    store.selectTracker('nb-1', 'sec-1', 'pg-deleted')

    store.selectTracker('nb-1', 'sec-1', 'pg-fallback')
    expect(getSelection().activeTrackerId).toBe('pg-fallback')

    store.selectSection('nb-1', 'sec-1')
    expect(getSelection()).toEqual({
      activeNotebookId: 'nb-1',
      activeSectionId: 'sec-1',
      activeTrackerId: null,
    })
  })

  it('does not notify subscribers when the complete selection is unchanged', () => {
    const listener = vi.fn()
    useNavigationSelectionStore.getState().selectTracker('nb-1', 'sec-1', 'pg-1')
    const unsubscribe = useNavigationSelectionStore.subscribe(listener)

    useNavigationSelectionStore.getState().selectTarget({
      notebookId: 'nb-1',
      sectionId: 'sec-1',
      pageId: 'pg-1',
    })

    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('clears the complete selection on sign-out reset', () => {
    const store = useNavigationSelectionStore.getState()
    store.selectTracker('nb-1', 'sec-1', 'pg-1')
    store.clearSelection()

    expect(getSelection()).toEqual({
      activeNotebookId: null,
      activeSectionId: null,
      activeTrackerId: null,
    })
  })
})
