export const normalizeNavigationTarget = (target = {}) => ({
  notebookId: target.notebookId ?? null,
  sectionId: target.sectionId ?? null,
  pageId: target.pageId ?? null,
  blockId: target.blockId ?? null,
})

export const getNavigationSpecificity = (target) => {
  if (!target) return 0
  if (target.pageId) return 3
  if (target.sectionId) return 2
  if (target.notebookId) return 1
  return 0
}

export const isWeakerDescendantTarget = (current, next) => {
  if (!current || !next) return false
  if (getNavigationSpecificity(next) >= getNavigationSpecificity(current)) return false
  if (current.notebookId && next.notebookId && current.notebookId !== next.notebookId) return false
  if (current.sectionId && next.sectionId && current.sectionId !== next.sectionId) return false
  return true
}

export const targetMatchesSelection = (target, selection) => {
  if (!target) return false
  if (target.pageId) return selection.activeTrackerId === target.pageId
  if (target.sectionId) return selection.activeSectionId === target.sectionId
  if (target.notebookId) return selection.activeNotebookId === target.notebookId
  return false
}

export const getNavigationApplyStep = ({
  target,
  notebooks = [],
  sections = [],
  trackers = [],
  activeNotebookId = null,
  activeSectionId = null,
  activeTrackerId = null,
  sectionsLoading = false,
  dataLoading = false,
}) => {
  if (!target?.notebookId) return { type: 'done' }

  if (!notebooks.some((item) => item.id === target.notebookId)) {
    return notebooks.length > 0 ? { type: 'missing' } : { type: 'wait' }
  }

  if (activeNotebookId !== target.notebookId) {
    return { type: 'notebook', id: target.notebookId }
  }

  if (!target.sectionId) return { type: 'done' }

  if (!sections.some((item) => item.id === target.sectionId && item.notebook_id === target.notebookId)) {
    if (sections.length === 0) return { type: 'wait' }
    return sectionsLoading ? { type: 'wait' } : { type: 'missing' }
  }

  if (activeSectionId !== target.sectionId) {
    return { type: 'section', id: target.sectionId }
  }

  if (!target.pageId) return { type: 'done' }

  if (!trackers.some((item) => item.id === target.pageId && item.section_id === target.sectionId)) {
    if (trackers.length === 0) return { type: 'wait' }
    return dataLoading ? { type: 'wait' } : { type: 'missing' }
  }

  if (activeTrackerId !== target.pageId) {
    return { type: 'page', id: target.pageId }
  }

  return { type: 'done' }
}
