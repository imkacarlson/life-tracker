import { describe, expect, it } from 'vitest'
import {
  getNavigationApplyStep,
  isWeakerDescendantTarget,
  normalizeNavigationTarget,
  targetMatchesSelection,
} from '../navigationTarget'

describe('normalizeNavigationTarget', () => {
  it('fills absent target fields with null', () => {
    expect(normalizeNavigationTarget({ pageId: 'page-1' })).toEqual({
      notebookId: null,
      sectionId: null,
      pageId: 'page-1',
      blockId: null,
    })
  })
})

describe('isWeakerDescendantTarget', () => {
  it('ignores notebook-only fallbacks while a page target is pending in the same branch', () => {
    expect(
      isWeakerDescendantTarget(
        { notebookId: 'nb-1', sectionId: 'sec-1', pageId: 'pg-1' },
        { notebookId: 'nb-1' },
      ),
    ).toBe(true)
  })

  it('allows targets from another notebook', () => {
    expect(
      isWeakerDescendantTarget(
        { notebookId: 'nb-1', sectionId: 'sec-1', pageId: 'pg-1' },
        { notebookId: 'nb-2' },
      ),
    ).toBe(false)
  })
})

describe('targetMatchesSelection', () => {
  it('matches at the most specific target level', () => {
    expect(
      targetMatchesSelection(
        { notebookId: 'nb-1', sectionId: 'sec-1', pageId: 'pg-1' },
        { activeNotebookId: 'nb-1', activeSectionId: 'sec-1', activeTrackerId: 'pg-1' },
      ),
    ).toBe(true)
    expect(
      targetMatchesSelection(
        { notebookId: 'nb-1', sectionId: 'sec-1' },
        { activeNotebookId: 'nb-1', activeSectionId: 'sec-1', activeTrackerId: 'pg-2' },
      ),
    ).toBe(true)
  })
})

const notebooks = [{ id: 'nb-1' }, { id: 'nb-2' }]
const sections = [
  { id: 'sec-1', notebook_id: 'nb-1' },
  { id: 'sec-2', notebook_id: 'nb-2' },
]

const loadedSectionPageCache = {
  'sec-1': { status: 'loaded', pages: [{ id: 'pg-1', section_id: 'sec-1' }], error: null },
  'sec-2': { status: 'loaded', pages: [{ id: 'pg-2', section_id: 'sec-2' }], error: null },
}

describe('getNavigationApplyStep', () => {
  it('applies navigation in notebook, section, then page order', () => {
    const target = { notebookId: 'nb-2', sectionId: 'sec-2', pageId: 'pg-2' }

    expect(getNavigationApplyStep({ target, notebooks, sections, sectionPageCache: loadedSectionPageCache, activeNotebookId: 'nb-1' }))
      .toEqual({ type: 'notebook', id: 'nb-2' })

    expect(getNavigationApplyStep({
      target,
      notebooks,
      sections,
      sectionPageCache: loadedSectionPageCache,
      activeNotebookId: 'nb-2',
      activeSectionId: 'sec-1',
    })).toEqual({ type: 'section', id: 'sec-2' })

    expect(getNavigationApplyStep({
      target,
      notebooks,
      sections,
      sectionPageCache: loadedSectionPageCache,
      activeNotebookId: 'nb-2',
      activeSectionId: 'sec-2',
      activeTrackerId: 'pg-1',
    })).toEqual({ type: 'page', id: 'pg-2' })
  })

  it('waits when the target section pages are not yet in the cache (idle)', () => {
    expect(getNavigationApplyStep({
      target: { notebookId: 'nb-2', sectionId: 'sec-2', pageId: 'pg-2' },
      notebooks,
      sections,
      sectionPageCache: {},
      activeNotebookId: 'nb-2',
      activeSectionId: 'sec-2',
    })).toEqual({ type: 'wait' })
  })

  it('waits when the target section pages are still loading', () => {
    expect(getNavigationApplyStep({
      target: { notebookId: 'nb-2', sectionId: 'sec-2', pageId: 'pg-2' },
      notebooks,
      sections,
      sectionPageCache: { 'sec-2': { status: 'loading', pages: [], error: null } },
      activeNotebookId: 'nb-2',
      activeSectionId: 'sec-2',
    })).toEqual({ type: 'wait' })
  })

  it('treats a page as missing when the section is loaded but the page is not in it', () => {
    expect(getNavigationApplyStep({
      target: { notebookId: 'nb-2', sectionId: 'sec-2', pageId: 'pg-missing' },
      notebooks,
      sections,
      sectionPageCache: loadedSectionPageCache,
      activeNotebookId: 'nb-2',
      activeSectionId: 'sec-2',
    })).toEqual({ type: 'missing' })
  })

  it('treats a page as missing when the section cache is in error state', () => {
    expect(getNavigationApplyStep({
      target: { notebookId: 'nb-2', sectionId: 'sec-2', pageId: 'pg-2' },
      notebooks,
      sections,
      sectionPageCache: { 'sec-2': { status: 'error', pages: [], error: 'network error' } },
      activeNotebookId: 'nb-2',
      activeSectionId: 'sec-2',
    })).toEqual({ type: 'missing' })
  })

  it('returns done when the target page is already active', () => {
    expect(getNavigationApplyStep({
      target: { notebookId: 'nb-1', sectionId: 'sec-1', pageId: 'pg-1' },
      notebooks,
      sections,
      sectionPageCache: loadedSectionPageCache,
      activeNotebookId: 'nb-1',
      activeSectionId: 'sec-1',
      activeTrackerId: 'pg-1',
    })).toEqual({ type: 'done' })
  })
})
