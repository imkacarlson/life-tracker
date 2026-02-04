import { STORAGE_KEY } from './constants'

export const readStoredSelection = () => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export const saveSelection = (notebookId, sectionId, pageId) => {
  if (typeof window === 'undefined') return
  const selection = {
    notebookId: notebookId ?? null,
    sectionId: sectionId ?? null,
    pageId: pageId ?? null,
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection))
  } catch {
    // Ignore storage errors
  }
}
