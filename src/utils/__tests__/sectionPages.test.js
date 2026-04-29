import { describe, it, expect } from 'vitest'
import {
  SECTION_PAGE_STATUS,
  getSectionPageEntry,
  getSectionPages,
  removeSectionPage,
  setSectionPagesLoaded,
  setSectionPagesLoading,
  setSectionTrackerPage,
  updateSectionPage,
  upsertSectionPage,
} from '../sectionPages'

const makePages = () => [
  { id: 'p1', title: 'Alpha', section_id: 's1', sort_order: 2, is_tracker_page: false },
  { id: 'p2', title: 'Beta',  section_id: 's1', sort_order: 1, is_tracker_page: false },
  { id: 'p3', title: 'Gamma', section_id: 's2', sort_order: 1, is_tracker_page: true },
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

    cache = setSectionTrackerPage(cache, 's1', 'p1')
    expect(getSectionPages(cache, 's1').find((page) => page.id === 'p1').is_tracker_page).toBe(true)
    expect(getSectionPages(cache, 's1').find((page) => page.id === 'p2').is_tracker_page).toBe(false)

    cache = removeSectionPage(cache, 's1', 'p1')
    expect(getSectionPages(cache, 's1').map((page) => page.id)).toEqual(['p2'])
  })
})
