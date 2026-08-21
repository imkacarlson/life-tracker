import { toClientPage } from './pageModel'

export const SECTION_PAGE_STATUS = {
  IDLE: 'idle',
  LOADING: 'loading',
  LOADED: 'loaded',
  ERROR: 'error',
}

export function toSectionPageMeta(page) {
  const clientPage = toClientPage(page)
  return {
    id: clientPage.id,
    title: clientPage.title,
    section_id: clientPage.section_id,
    sort_order: clientPage.sort_order ?? null,
    isDailySource: clientPage.isDailySource,
    // Carried so the tree can place Library pages by role: captures and front
    // pages are hidden, Lately and Activity are hoisted to the notebook level.
    // Deliberately NOT filtered here: getSectionPages() also feeds usePages'
    // activePageServer lookup, and filtering at the source would make a hidden
    // page impossible to open at all.
    libraryRole: clientPage.libraryRole ?? null,
  }
}

export function sortSectionPages(pages = []) {
  return [...pages].sort((a, b) => {
    const aOrder = a.sort_order ?? Infinity
    const bOrder = b.sort_order ?? Infinity
    return aOrder - bOrder
  })
}

export function makeSectionPageEntry(status, pages = [], error = null) {
  return {
    status,
    pages: sortSectionPages(pages.map(toSectionPageMeta)),
    error,
  }
}

export function getSectionPageEntry(sectionPageCache = {}, sectionId) {
  const entry = sectionPageCache[sectionId]
  if (Array.isArray(entry)) {
    return makeSectionPageEntry(SECTION_PAGE_STATUS.LOADED, entry)
  }
  if (!entry) {
    return makeSectionPageEntry(SECTION_PAGE_STATUS.IDLE)
  }
  return makeSectionPageEntry(
    entry.status ?? SECTION_PAGE_STATUS.IDLE,
    entry.pages ?? [],
    entry.error ?? null,
  )
}

/**
 * Returns a sorted copy of the pages cached for a given section.
 * Pages with a null/undefined sort_order sort to the end.
 */
export function getSectionPages(sectionPageCache, sectionId) {
  return getSectionPageEntry(sectionPageCache, sectionId).pages
}

/**
 * The Library page roles that never appear as a row under their section.
 *
 *   capture        reached from a topic page, a section front page, search, or a
 *                  citation on an answer.
 *   section_index  IS the section: clicking the section row opens it, so a child
 *                  row would be the same thing listed twice.
 *   lately         Library-wide, hoisted to the top of the notebook.
 *   activity       Library-wide, hoisted to the bottom.
 *
 * The last three live in the tree at a DIFFERENT position rather than nowhere —
 * see libraryTree.js. Every other page kind (including every page in a tracker
 * or recipes notebook, where libraryRole is null) is returned untouched.
 */
export const HIDDEN_TREE_ROLES = new Set(['capture', 'section_index', 'lately', 'activity'])

/**
 * The pages a section shows as its own child rows in the sidebar tree.
 *
 * This is a SEPARATE function from getSectionPages() on purpose. getSectionPages
 * also feeds usePages' `cachedActiveSectionPages` -> `activePageServer` lookup
 * and the section-landing rule below; filtering there would make a hidden page
 * impossible to open at all. Render and drag-and-drop both read THIS one, so the
 * two stay consistent — a row with no handle, or a handle with no row, is the
 * failure mode this shared accessor exists to prevent.
 */
export function getVisibleSectionPages(sectionPageCache, sectionId) {
  return getSectionPages(sectionPageCache, sectionId).filter(
    (page) => !HIDDEN_TREE_ROLES.has(page.libraryRole),
  )
}

/**
 * The page a section opens to when its row is clicked.
 *
 * Role first, position second. A Library section's front page IS the section, so
 * it wins wherever it sits in the list — and it does move: createPage reindexes
 * every page in a section to `index + 1`, so the sentinel sort_order the rebuild
 * gave it is not something to rely on. Choosing by role rather than by order is
 * what makes that harmless.
 *
 * Falls back to the first visible page, then to the first page of any kind, so a
 * section holding nothing but hidden pages still opens something rather than
 * stranding the user on an empty pane.
 *
 * @param {Array<{ id: string, libraryRole?: string|null }>} pages the UNFILTERED list
 * @returns {object|null}
 */
export function pickSectionLandingPage(pages = []) {
  if (!Array.isArray(pages) || pages.length === 0) return null
  const front = pages.find((page) => page.libraryRole === 'section_index')
  if (front) return front
  const visible = pages.find((page) => !HIDDEN_TREE_ROLES.has(page.libraryRole))
  return visible ?? pages[0]
}


export function areSectionPagesLoaded(sectionPageCache, sectionId) {
  return getSectionPageEntry(sectionPageCache, sectionId).status === SECTION_PAGE_STATUS.LOADED
}

export function setSectionPagesLoading(sectionPageCache, sectionId) {
  const current = getSectionPageEntry(sectionPageCache, sectionId)
  return {
    ...sectionPageCache,
    [sectionId]: makeSectionPageEntry(SECTION_PAGE_STATUS.LOADING, current.pages),
  }
}

export function setSectionPagesLoaded(sectionPageCache, sectionId, pages) {
  return {
    ...sectionPageCache,
    [sectionId]: makeSectionPageEntry(SECTION_PAGE_STATUS.LOADED, pages),
  }
}

export function setSectionPagesError(sectionPageCache, sectionId, error) {
  const current = getSectionPageEntry(sectionPageCache, sectionId)
  return {
    ...sectionPageCache,
    [sectionId]: makeSectionPageEntry(SECTION_PAGE_STATUS.ERROR, current.pages, error),
  }
}

export function upsertSectionPage(sectionPageCache, sectionId, page) {
  const current = getSectionPageEntry(sectionPageCache, sectionId)
  if (current.status !== SECTION_PAGE_STATUS.LOADED) return sectionPageCache
  const meta = toSectionPageMeta({ ...page, section_id: page.section_id ?? sectionId })
  const found = current.pages.some((item) => item.id === meta.id)
  const pages = found
    ? current.pages.map((item) => (item.id === meta.id ? { ...item, ...meta } : item))
    : [...current.pages, meta]
  return setSectionPagesLoaded(sectionPageCache, sectionId, pages)
}

export function updateSectionPage(sectionPageCache, sectionId, pageId, changes) {
  const current = getSectionPageEntry(sectionPageCache, sectionId)
  if (current.status !== SECTION_PAGE_STATUS.LOADED) return sectionPageCache
  const pages = current.pages.map((page) =>
    page.id === pageId ? toSectionPageMeta({ ...page, ...changes }) : page,
  )
  return setSectionPagesLoaded(sectionPageCache, sectionId, pages)
}

export function removeSectionPage(sectionPageCache, sectionId, pageId) {
  const current = getSectionPageEntry(sectionPageCache, sectionId)
  if (current.status !== SECTION_PAGE_STATUS.LOADED) return sectionPageCache
  return setSectionPagesLoaded(
    sectionPageCache,
    sectionId,
    current.pages.filter((page) => page.id !== pageId),
  )
}

export function setSectionDailySourcePage(sectionPageCache, sectionId, pageId) {
  const current = getSectionPageEntry(sectionPageCache, sectionId)
  if (current.status !== SECTION_PAGE_STATUS.LOADED) return sectionPageCache
  const pages = current.pages.map((page) => ({
    ...page,
    isDailySource: page.id === pageId,
  }))
  return setSectionPagesLoaded(sectionPageCache, sectionId, pages)
}
