import {
  MAX_SCROLL_POSITIONS,
  SCROLL_POSITIONS_KEY,
  SIDEBAR_COLLAPSED_KEY,
  SIDEBAR_WIDTH_STORAGE_KEY,
  STORAGE_KEY,
} from './constants'

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

export const readStoredSidebarCollapsed = (fallbackValue) => {
  if (typeof window === 'undefined') return fallbackValue
  try {
    const raw = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
    if (raw === null) return fallbackValue
    return raw === 'true'
  } catch {
    return fallbackValue
  }
}

export const saveStoredSidebarCollapsed = (collapsed) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, `${collapsed}`)
  } catch {
    // Ignore storage errors
  }
}

// Per-page scroll positions live in sessionStorage as a plain
// `{ [pageId]: scrollTop }` map. Session scope means they survive a reload but
// not a new tab/session, matching how scroll restoration is expected to behave.
export const readStoredScrollPositions = () => {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.sessionStorage.getItem(SCROLL_POSITIONS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    // Keep only finite numeric offsets; drop anything malformed.
    const clean = {}
    for (const [pageId, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value)) clean[pageId] = value
    }
    return clean
  } catch {
    return {}
  }
}

export const saveStoredScrollPositions = (positions) => {
  if (typeof window === 'undefined') return
  try {
    const entries = Object.entries(positions || {}).filter(
      ([, value]) => typeof value === 'number' && Number.isFinite(value),
    )
    // Object insertion order is preserved, so slicing the tail keeps the
    // most-recently-written (most-recent) page offsets and evicts the oldest.
    const capped = entries.slice(-MAX_SCROLL_POSITIONS)
    window.sessionStorage.setItem(SCROLL_POSITIONS_KEY, JSON.stringify(Object.fromEntries(capped)))
  } catch {
    // Ignore storage errors
  }
}

// Color tools persist a hex string or `null` ("No Color"). `null` is a real,
// intentional state — distinct from "never set" — so it is encoded as an empty
// string sentinel and decoded back to `null` on read. A missing key returns the
// caller's fallback (which may itself be `null`).
const NULL_COLOR_SENTINEL = ''

export const readStoredColor = (key, fallback) => {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    return raw === NULL_COLOR_SENTINEL ? null : raw
  } catch {
    return fallback
  }
}

export const saveStoredColor = (key, value) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value == null ? NULL_COLOR_SENTINEL : value)
  } catch {
    // Ignore storage errors
  }
}
