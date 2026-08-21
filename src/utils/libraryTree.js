// How a Library notebook is laid out in the sidebar, derived from what its
// sections actually hold.
//
// The shape this produces:
//
//   Library
//     Lately                 <- hoisted, always first
//     Running        31      <- clicking it opens its front page
//       Fueling   CATALOG
//     Activity               <- hoisted, always last
//
// Lately and Activity live inside a section, because the rebuild has to put them
// somewhere. But they are Library-WIDE, and nesting them under a section called
// "Home" — a section the user never made and cannot explain — put the two most
// useful pages in the notebook where nobody would look. They are hoisted to
// notebook level and that section is suppressed.
//
// NOTHING HERE MATCHES ON A TITLE. The home section is found by what it holds,
// mirroring ensureHomeSection in _shared/libraryRebuild.ts. Both sides have to
// agree: if this matched the title and the rebuild matched the contents, then
// renaming the section would make the sidebar suppress one section while the
// rebuild kept writing to another.

import { HIDDEN_TREE_ROLES, getSectionPageEntry } from './sectionPages'

const HOISTED_ROLES = ['lately', 'activity']

/** Pages the section shows in the tree on its own account — anything that is not
 *  hidden by role. An empty result is what makes a home section suppressible. */
function ownVisiblePages(sectionId, sectionPageCache) {
  return getSectionPageEntry(sectionPageCache, sectionId).pages.filter(
    (page) => !HIDDEN_TREE_ROLES.has(page.libraryRole),
  )
}

/**
 * Work out the Library layout for one notebook.
 *
 * Cold cache is a pass-through: page metadata loads lazily, so before the first
 * fetch there is nothing to hoist and nothing to suppress, and every section
 * renders as an ordinary one. NavigationTree prefetches an expanded Library's
 * sections precisely so that state is brief.
 *
 * @param {Array<{ id: string }>} sections the notebook's sections, in order
 * @param {object} sectionPageCache
 * @returns {{
 *   homeSectionId: string|null,
 *   lately: object|null,
 *   activity: object|null,
 *   sections: Array<{ id: string }>,
 * }}
 */
export function getLibraryTreeShape(sections = [], sectionPageCache = {}) {
  const list = Array.isArray(sections) ? sections : []

  // 1. Whichever section holds Lately or Activity IS the home section.
  const home =
    list.find((section) =>
      getSectionPageEntry(sectionPageCache, section.id).pages.some((page) =>
        HOISTED_ROLES.includes(page.libraryRole),
      ),
    ) ?? null

  if (!home) {
    return { homeSectionId: null, lately: null, activity: null, sections: list }
  }

  const homePages = getSectionPageEntry(sectionPageCache, home.id).pages
  // The section id rides along so clicking a hoisted row can select its parent.
  const hoist = (role) => {
    const page = homePages.find((item) => item.libraryRole === role)
    return page ? { ...page, sectionId: home.id } : null
  }

  // 2. Suppress the home row only when there is nothing else in it. If a page
  //    ever lands in there — the user creating one, a bug, a later feature —
  //    hiding the section would orphan it: no row, and no way in. A redundant
  //    "Home" row the user can see and act on beats a page that cannot be
  //    reached at all.
  const suppressed = ownVisiblePages(home.id, sectionPageCache).length === 0

  return {
    homeSectionId: home.id,
    lately: hoist('lately'),
    activity: hoist('activity'),
    sections: suppressed ? list.filter((section) => section.id !== home.id) : list,
  }
}

/**
 * getLibraryTreeShape for every Library notebook, keyed by notebook id.
 *
 * Notebooks of any other type are absent from the result, which is how callers
 * tell "not a Library" from "a Library whose pages have not loaded yet".
 *
 * @param {Array<{ id: string, type?: string }>} notebooks
 * @param {Array<{ id: string, notebook_id: string }>} sections
 * @param {object} sectionPageCache
 * @returns {Record<string, ReturnType<typeof getLibraryTreeShape>>}
 */
export function buildLibraryTreeShapes(notebooks = [], sections = [], sectionPageCache = {}) {
  const shapes = {}
  for (const notebook of notebooks ?? []) {
    if (notebook?.type !== 'library') continue
    shapes[notebook.id] = getLibraryTreeShape(
      (sections ?? []).filter((section) => section.notebook_id === notebook.id),
      sectionPageCache,
    )
  }
  return shapes
}
