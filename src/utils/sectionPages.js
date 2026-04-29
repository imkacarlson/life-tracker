export const SECTION_PAGE_STATUS = {
  IDLE: 'idle',
  LOADING: 'loading',
  LOADED: 'loaded',
  ERROR: 'error',
}

export function toSectionPageMeta(page) {
  return {
    id: page.id,
    title: page.title,
    section_id: page.section_id,
    sort_order: page.sort_order ?? null,
    is_tracker_page: Boolean(page.is_tracker_page),
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

export function setSectionTrackerPage(sectionPageCache, sectionId, pageId) {
  const current = getSectionPageEntry(sectionPageCache, sectionId)
  if (current.status !== SECTION_PAGE_STATUS.LOADED) return sectionPageCache
  const pages = current.pages.map((page) => ({
    ...page,
    is_tracker_page: page.id === pageId,
  }))
  return setSectionPagesLoaded(sectionPageCache, sectionId, pages)
}
