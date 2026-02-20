import { SIDEBAR_WIDTH_STORAGE_KEY, STORAGE_KEY } from './constants'

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

export const readStoredSidebarWidth = (fallbackWidth) => {
  if (typeof window === 'undefined') return fallbackWidth
  try {
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
    if (!raw) return fallbackWidth
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackWidth
  } catch {
    return fallbackWidth
  }
}

export const saveStoredSidebarWidth = (width) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, `${width}`)
  } catch {
    // Ignore storage errors
  }
}
