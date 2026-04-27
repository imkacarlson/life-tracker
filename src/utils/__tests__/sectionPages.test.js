import { describe, it, expect } from 'vitest'
import { getSectionPages } from '../sectionPages'

const makePages = () => [
  { id: 'p1', title: 'Alpha', section_id: 's1', sort_order: 2, is_tracker_page: false },
  { id: 'p2', title: 'Beta',  section_id: 's1', sort_order: 1, is_tracker_page: false },
  { id: 'p3', title: 'Gamma', section_id: 's2', sort_order: 1, is_tracker_page: true },
]

describe('getSectionPages', () => {
  it('returns pages for a known section sorted ascending by sort_order', () => {
    const pagesBySection = { s1: [makePages()[0], makePages()[1]] }
    const result = getSectionPages(pagesBySection, 's1')
    expect(result.map((p) => p.id)).toEqual(['p2', 'p1'])
  })

  it('returns an empty array for an unknown section', () => {
    expect(getSectionPages({ s1: [] }, 'unknown')).toEqual([])
  })

  it('returns an empty array when pagesBySection is an empty object', () => {
    expect(getSectionPages({}, 's1')).toEqual([])
  })

  it('returns a single page without error', () => {
    const pagesBySection = { s2: [makePages()[2]] }
    const result = getSectionPages(pagesBySection, 's2')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('p3')
  })

  it('sorts null sort_order to the end', () => {
    const pagesBySection = {
      s1: [
        { id: 'pA', sort_order: null },
        { id: 'pB', sort_order: 1 },
        { id: 'pC', sort_order: 3 },
      ],
    }
    const result = getSectionPages(pagesBySection, 's1')
    expect(result.map((p) => p.id)).toEqual(['pB', 'pC', 'pA'])
  })

  it('does not mutate the source array', () => {
    const source = [
      { id: 'p2', sort_order: 2 },
      { id: 'p1', sort_order: 1 },
    ]
    const pagesBySection = { s1: source }
    getSectionPages(pagesBySection, 's1')
    expect(source[0].id).toBe('p2')
  })
})
