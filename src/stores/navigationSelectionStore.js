import { create } from 'zustand'

const EMPTY_SELECTION = {
  activeNotebookId: null,
  activeSectionId: null,
  activePageId: null,
}

const normalizeSelection = ({ notebookId = null, sectionId = null, pageId = null } = {}) => {
  if (!notebookId) return EMPTY_SELECTION
  if (!sectionId) {
    return {
      activeNotebookId: notebookId,
      activeSectionId: null,
      activePageId: null,
    }
  }
  return {
    activeNotebookId: notebookId,
    activeSectionId: sectionId,
    activePageId: pageId ?? null,
  }
}

const selectionMatches = (state, next) =>
  state.activeNotebookId === next.activeNotebookId &&
  state.activeSectionId === next.activeSectionId &&
  state.activePageId === next.activePageId

export const useNavigationSelectionStore = create((set) => {
  const commitSelection = (target) => {
    const next = normalizeSelection(target)
    set((state) => (selectionMatches(state, next) ? state : next))
  }

  return {
    ...EMPTY_SELECTION,
    selectNotebook: (notebookId) => commitSelection({ notebookId }),
    selectSection: (notebookId, sectionId) => commitSelection({ notebookId, sectionId }),
    selectPage: (notebookId, sectionId, pageId) =>
      commitSelection({ notebookId, sectionId, pageId }),
    selectTarget: (target) => commitSelection(target),
    clearSelection: () => commitSelection(EMPTY_SELECTION),
  }
})
