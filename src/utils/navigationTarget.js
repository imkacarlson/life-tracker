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
  if (target.notebookId && selection.activeNotebookId !== target.notebookId) return false
  if (target.sectionId && selection.activeSectionId !== target.sectionId) return false
  if (target.pageId && selection.activePageId !== target.pageId) return false
  return Boolean(target.notebookId || target.sectionId || target.pageId)
}

export const getNavigationTargetStatus = ({
  target,
  notebooks = [],
  notebooksLoading = false,
  sections = [],
  sectionPageCache = {},
  sectionsLoading = false,
}) => {
  if (!target?.notebookId) return { type: 'missing' }

  if (!notebooks.some((item) => item.id === target.notebookId)) {
    return notebooksLoading ? { type: 'wait' } : { type: 'missing' }
  }

  if (!target.sectionId) return { type: 'ready' }

  if (!sections.some((item) => item.id === target.sectionId && item.notebook_id === target.notebookId)) {
    return sectionsLoading ? { type: 'wait' } : { type: 'missing' }
  }

  if (!target.pageId) return { type: 'ready' }

  // Page metadata can be loaded independently of the active section, allowing
  // the complete hierarchy to be validated before selection changes.
  const sectionEntry = sectionPageCache[target.sectionId]
  if (!sectionEntry || sectionEntry.status === 'idle' || sectionEntry.status === 'loading') {
    return { type: 'wait' }
  }
  if (sectionEntry.status === 'error') {
    return { type: 'missing' }
  }
  // status === 'loaded'
  if (!sectionEntry.pages?.some((p) => p.id === target.pageId)) {
    return { type: 'missing' }
  }

  return { type: 'ready' }
}
