import { describe, it, expect } from 'vitest'
import { buildLibraryTreeShapes, getLibraryTreeShape } from '../libraryTree'
import { setSectionPagesLoaded } from '../sectionPages'

const SECTIONS = [
  { id: 'sec-running', title: 'Running', notebook_id: 'nb-lib' },
  { id: 'sec-home', title: 'Home', notebook_id: 'nb-lib' },
]

const page = (id, title, role, sectionId, sortOrder = 0) => ({
  id,
  title,
  section_id: sectionId,
  sort_order: sortOrder,
  library_role: role,
})

/** Running holds a topic and a capture; Home holds only Lately and Activity. */
const loadedCache = (homePages, runningPages = null) => {
  let cache = setSectionPagesLoaded({}, 'sec-running', runningPages ?? [
    page('p-topic', 'Fueling', 'topic', 'sec-running', 1),
    page('p-cap', 'An article', 'capture', 'sec-running', 2),
  ])
  return setSectionPagesLoaded(cache, 'sec-home', homePages)
}

const HOME_PAIR = [
  page('p-lately', 'Lately', 'lately', 'sec-home', -2),
  page('p-activity', 'Activity', 'activity', 'sec-home', -1),
]

describe('getLibraryTreeShape', () => {
  it('hoists Lately and Activity out and drops the section that held them', () => {
    const shape = getLibraryTreeShape(SECTIONS, loadedCache(HOME_PAIR))

    expect(shape.homeSectionId).toBe('sec-home')
    expect(shape.lately.id).toBe('p-lately')
    expect(shape.activity.id).toBe('p-activity')
    expect(shape.sections.map((section) => section.id)).toEqual(['sec-running'])
  })

  it('carries the section id so a hoisted row can still select its parent', () => {
    const shape = getLibraryTreeShape(SECTIONS, loadedCache(HOME_PAIR))
    expect(shape.lately.sectionId).toBe('sec-home')
    expect(shape.activity.sectionId).toBe('sec-home')
  })

  it('finds the home section by what it holds, so a rename sticks', () => {
    // Same rule as ensureHomeSection in _shared/libraryRebuild.ts. If this
    // matched titles while the rebuild matched contents, renaming the section
    // would make the sidebar suppress one and the rebuild write to another.
    const renamed = [
      { id: 'sec-running', title: 'Running', notebook_id: 'nb-lib' },
      { id: 'sec-home', title: 'Shelf', notebook_id: 'nb-lib' },
    ]
    const shape = getLibraryTreeShape(renamed, loadedCache(HOME_PAIR))
    expect(shape.homeSectionId).toBe('sec-home')
    expect(shape.sections.map((section) => section.id)).toEqual(['sec-running'])
  })

  it('does not suppress a section merely because it is called Home', () => {
    // A user section that happens to carry the name keeps its row and its pages.
    const shape = getLibraryTreeShape(SECTIONS, loadedCache([
      page('p-note', 'Reading list', 'topic', 'sec-home', 1),
    ]))
    expect(shape.homeSectionId).toBeNull()
    expect(shape.lately).toBeNull()
    expect(shape.sections.map((section) => section.id)).toEqual(['sec-running', 'sec-home'])
  })

  it('keeps the home row when a stray page lands in it', () => {
    // Suppressing it then would orphan that page: no row, and no way back to it.
    // A redundant row the user can see beats a page they cannot reach.
    const shape = getLibraryTreeShape(SECTIONS, loadedCache([
      ...HOME_PAIR,
      page('p-stray', 'Untitled', null, 'sec-home', 1),
    ]))
    expect(shape.homeSectionId).toBe('sec-home')
    expect(shape.lately.id).toBe('p-lately')
    expect(shape.sections.map((section) => section.id)).toEqual(['sec-running', 'sec-home'])
  })

  it('still suppresses when the only extra page is itself hidden', () => {
    const shape = getLibraryTreeShape(SECTIONS, loadedCache([
      ...HOME_PAIR,
      page('p-cap2', 'Something saved', 'capture', 'sec-home', 1),
    ]))
    expect(shape.sections.map((section) => section.id)).toEqual(['sec-running'])
  })

  it('passes everything through on a cold cache', () => {
    // Page metadata is lazy, so before the first fetch there is nothing to
    // hoist and nothing to suppress. Every section renders as an ordinary one
    // until it settles.
    const shape = getLibraryTreeShape(SECTIONS, {})
    expect(shape.homeSectionId).toBeNull()
    expect(shape.lately).toBeNull()
    expect(shape.activity).toBeNull()
    expect(shape.sections).toEqual(SECTIONS)
  })

  it('handles a Library with no sections at all', () => {
    const shape = getLibraryTreeShape([], {})
    expect(shape.sections).toEqual([])
    expect(shape.homeSectionId).toBeNull()
  })

  it('hoists whichever of the pair exists when only one has been made', () => {
    const shape = getLibraryTreeShape(SECTIONS, loadedCache([HOME_PAIR[0]]))
    expect(shape.lately.id).toBe('p-lately')
    expect(shape.activity).toBeNull()
    expect(shape.sections.map((section) => section.id)).toEqual(['sec-running'])
  })
})

describe('buildLibraryTreeShapes', () => {
  const NOTEBOOKS = [
    { id: 'nb-lib', title: 'Library', type: 'library' },
    { id: 'nb-tracker', title: 'Trackers', type: 'tracker' },
  ]
  const ALL_SECTIONS = [
    ...SECTIONS,
    { id: 'sec-aug', title: 'August', notebook_id: 'nb-tracker' },
  ]

  it('shapes only the Library notebooks', () => {
    const shapes = buildLibraryTreeShapes(NOTEBOOKS, ALL_SECTIONS, loadedCache(HOME_PAIR))
    expect(Object.keys(shapes)).toEqual(['nb-lib'])
    // Absent, not empty — that is how a caller tells "not a Library" from
    // "a Library whose pages have not loaded yet".
    expect(shapes['nb-tracker']).toBeUndefined()
  })

  it('never lets one notebook see another notebook’s sections', () => {
    const shapes = buildLibraryTreeShapes(NOTEBOOKS, ALL_SECTIONS, loadedCache(HOME_PAIR))
    expect(shapes['nb-lib'].sections.map((section) => section.id)).toEqual(['sec-running'])
  })

  it('copes with missing arguments', () => {
    expect(buildLibraryTreeShapes()).toEqual({})
    expect(buildLibraryTreeShapes(NOTEBOOKS, [], {})['nb-lib'].sections).toEqual([])
  })
})
