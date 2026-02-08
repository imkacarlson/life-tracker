const DRAFT_PREFIX = 'lifeTracker:draft:page:'

const safeParse = (raw) => {
  if (!raw || typeof raw !== 'string') return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export const readPageDraft = (pageId) => {
  if (!pageId) return null
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    const raw = window.localStorage.getItem(`${DRAFT_PREFIX}${pageId}`)
    const parsed = safeParse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (!parsed.content) return null
    return parsed
  } catch {
    return null
  }
}

export const writePageDraft = (pageId, draft) => {
  if (!pageId || !draft) return
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(`${DRAFT_PREFIX}${pageId}`, JSON.stringify(draft))
  } catch {
    // Ignore quota / private mode / disabled storage.
  }
}

export const clearPageDraft = (pageId) => {
  if (!pageId) return
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.removeItem(`${DRAFT_PREFIX}${pageId}`)
  } catch {
    // Ignore.
  }
}
