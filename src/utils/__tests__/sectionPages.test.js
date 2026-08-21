import { describe, it, expect } from 'vitest'
import {
  SECTION_PAGE_STATUS,
  getSectionPageEntry,
  getSectionPages,
  getVisibleSectionPages,
  pickSectionLandingPage,
  removeSectionPage,
  setSectionPagesLoaded,
  setSectionPagesLoading,
  setSectionDailySourcePage,
  sortSectionPages,
  toSectionPageMeta,
  updateSectionPage,
  upsertSectionPage,
} from '../sectionPages'

const makePages = () => [
  { id: 'p1', title: 'Alpha', section_id: 's1', sort_order: 2, isDailySource: false },
  { id: 'p2', title: 'Beta',  section_id: 's1', sort_order: 1, isDailySource: false },
  { id: 'p3', title: 'Gamma', section_id: 's2', sort_order: 1, isDailySource: true },
]

describe('getSectionPages', () => {
  it('returns pages for a known section sorted ascending by sort_order', () => {
    const sectionPageCache = setSectionPagesLoaded({}, 's1', [makePages()[0], makePages()[1]])
    const result = getSectionPages(sectionPageCache, 's1')
    expect(result.map((p) => p.id)).toEqual(['p2', 'p1'])
  })

  it('returns an empty array for an unknown section', () => {
    expect(getSectionPages({ s1: [] }, 'unknown')).toEqual([])
  })

  it('returns an empty array when pagesBySection is an empty object', () => {
    expect(getSectionPages({}, 's1')).toEqual([])
  })

  it('returns a single page without error', () => {
    const sectionPageCache = setSectionPagesLoaded({}, 's2', [makePages()[2]])
    const result = getSectionPages(sectionPageCache, 's2')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('p3')
  })

  it('sorts null sort_order to the end', () => {
    const sectionPageCache = setSectionPagesLoaded({}, 's1', [
      { id: 'pA', section_id: 's1', sort_order: null },
      { id: 'pB', section_id: 's1', sort_order: 1 },
      { id: 'pC', section_id: 's1', sort_order: 3 },
    ])
    const result = getSectionPages(sectionPageCache, 's1')
    expect(result.map((p) => p.id)).toEqual(['pB', 'pC', 'pA'])
  })

  it('does not mutate the source array', () => {
    const source = [
      { id: 'p2', sort_order: 2 },
      { id: 'p1', sort_order: 1 },
    ]
    const sectionPageCache = setSectionPagesLoaded({}, 's1', source)
    getSectionPages(sectionPageCache, 's1')
    expect(source[0].id).toBe('p2')
  })

  it('distinguishes idle, loading, and loaded-empty sections', () => {
    expect(getSectionPageEntry({}, 's1').status).toBe(SECTION_PAGE_STATUS.IDLE)

    const loading = setSectionPagesLoading({}, 's1')
    expect(getSectionPageEntry(loading, 's1').status).toBe(SECTION_PAGE_STATUS.LOADING)

    const loaded = setSectionPagesLoaded({}, 's1', [])
    const entry = getSectionPageEntry(loaded, 's1')
    expect(entry.status).toBe(SECTION_PAGE_STATUS.LOADED)
    expect(entry.pages).toEqual([])
  })

  it('patches loaded page metadata without touching unknown sections', () => {
    const loaded = setSectionPagesLoaded({}, 's1', [makePages()[0]])
    const updated = updateSectionPage(loaded, 's1', 'p1', { title: 'Renamed' })
    expect(getSectionPages(updated, 's1')[0].title).toBe('Renamed')

    expect(updateSectionPage({}, 's1', 'p1', { title: 'Ignored' })).toEqual({})
  })

  it('upserts, removes, and marks tracker page metadata', () => {
    let cache = setSectionPagesLoaded({}, 's1', [])
    cache = upsertSectionPage(cache, 's1', makePages()[0])
    cache = upsertSectionPage(cache, 's1', makePages()[1])
    expect(getSectionPages(cache, 's1').map((page) => page.id)).toEqual(['p2', 'p1'])

    cache = setSectionDailySourcePage(cache, 's1', 'p1')
    expect(getSectionPages(cache, 's1').find((page) => page.id === 'p1').isDailySource).toBe(true)
    expect(getSectionPages(cache, 's1').find((page) => page.id === 'p2').isDailySource).toBe(false)

    cache = removeSectionPage(cache, 's1', 'p1')
    expect(getSectionPages(cache, 's1').map((page) => page.id)).toEqual(['p2'])
  })
})

describe('getVisibleSectionPages', () => {
  const withRoles = [
    { id: 'p1', title: 'Overview', section_id: 's1', sort_order: 1, library_role: 'section_index' },
    { id: 'p2', title: 'Fueling', section_id: 's1', sort_order: 2, library_role: 'topic' },
    { id: 'p3', title: 'Gut training article', section_id: 's1', sort_order: 3, library_role: 'capture' },
    { id: 'p4', title: 'Lately', section_id: 's1', sort_order: 4, library_role: 'lately' },
    { id: 'p5', title: 'Activity', section_id: 's1', sort_order: 5, library_role: 'activity' },
  ]

  it('shows only the pages that are rows of their own section', () => {
    // A capture is reached from a citation, a front page IS its section's row,
    // and Lately/Activity are hoisted to notebook level. Only the topic is a
    // child row here.
    const cache = setSectionPagesLoaded({}, 's1', withRoles)
    expect(getVisibleSectionPages(cache, 's1').map((p) => p.id)).toEqual(['p2'])
  })

  it('leaves getSectionPages untouched, so a hidden page can still be opened', () => {
    // Hidden is not the same as unopenable. This accessor feeds the
    // activePageServer lookup — filtering here would make every one of them
    // impossible to open at all, which is the bug this split exists to prevent.
    const cache = setSectionPagesLoaded({}, 's1', withRoles)
    expect(getSectionPages(cache, 's1').map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
  })

  it('returns every page in a non-Library section unchanged', () => {
    const cache = setSectionPagesLoaded({}, 's1', makePages().slice(0, 2))
    expect(getVisibleSectionPages(cache, 's1').map((p) => p.id)).toEqual(['p2', 'p1'])
  })

  it('returns an empty array for an unknown section', () => {
    expect(getVisibleSectionPages({}, 'unknown')).toEqual([])
  })
})

describe('pickSectionLandingPage', () => {
  it('opens the front page, wherever it sits in the order', () => {
    // The load-bearing case. createPage reindexes every page in a section to
    // index + 1, so the sentinel sort_order the rebuild gave the front page does
    // not survive. Selection has to be by ROLE, not by sort-order luck — here
    // the front page has the LARGEST order and must still win.
    const pages = [
      { id: 'p1', title: 'Fueling', sort_order: 1, library_role: 'topic' },
      { id: 'p2', title: 'An article', sort_order: 2, library_role: 'capture' },
      { id: 'p3', title: 'Overview', sort_order: 99, library_role: 'section_index' },
    ].map(toSectionPageMeta)
    expect(pickSectionLandingPage(pages).id).toBe('p3')
  })

  it('falls back to the first visible page when there is no front page', () => {
    const pages = [
      { id: 'p1', title: 'An article', sort_order: 1, library_role: 'capture' },
      { id: 'p2', title: 'Fueling', sort_order: 2, library_role: 'topic' },
    ].map(toSectionPageMeta)
    expect(pickSectionLandingPage(pages).id).toBe('p2')
  })

  it('opens a hidden page rather than nothing when that is all there is', () => {
    // A section holding only captures still has to open something — stranding
    // the user on an empty pane is worse than opening a page they can leave.
    const pages = [
      { id: 'p1', title: 'An article', sort_order: 1, library_role: 'capture' },
    ].map(toSectionPageMeta)
    expect(pickSectionLandingPage(pages).id).toBe('p1')
  })

  it('is just the first page in an ordinary notebook', () => {
    const pages = makePages()
    expect(pickSectionLandingPage(sortSectionPages(pages.map(toSectionPageMeta))).id).toBe('p2')
  })

  it('returns null for an empty or missing list', () => {
    expect(pickSectionLandingPage([])).toBeNull()
    expect(pickSectionLandingPage()).toBeNull()
    expect(pickSectionLandingPage(null)).toBeNull()
  })

})
