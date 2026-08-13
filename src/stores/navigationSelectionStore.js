import { create } from 'zustand'

const EMPTY_SELECTION = {
  activeNotebookId: null,
  activeSectionId: null,
  activeTrackerId: null,
}

const normalizeSelection = ({ notebookId = null, sectionId = null, pageId = null } = {}) => {
  if (!notebookId) return EMPTY_SELECTION
  if (!sectionId) {
    return {
      activeNotebookId: notebookId,
      activeSectionId: null,
      activeTrackerId: null,
    }
  }
  return {
    activeNotebookId: notebookId,
    activeSectionId: sectionId,
    activeTrackerId: pageId ?? null,
  }
}

const selectionMatches = (state, next) =>
  state.activeNotebookId === next.activeNotebookId &&
  state.activeSectionId === next.activeSectionId &&
  state.activeTrackerId === next.activeTrackerId

export const useNavigationSelectionStore = create((set) => {
  const commitSelection = (target) => {
    const next = normalizeSelection(target)
    set((state) => (selectionMatches(state, next) ? state : next))
  }

  return {
    ...EMPTY_SELECTION,
    selectNotebook: (notebookId) => commitSelection({ notebookId }),
    selectSection: (notebookId, sectionId) => commitSelection({ notebookId, sectionId }),
    selectTracker: (notebookId, sectionId, pageId) =>
      commitSelection({ notebookId, sectionId, pageId }),
    selectTarget: (target) => commitSelection(target),
    clearSelection: () => commitSelection(EMPTY_SELECTION),
  }
})
