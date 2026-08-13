import { describe, expect, it } from 'vitest'
import {
  getNavigationTargetStatus,
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
  it('matches every hierarchy level supplied by the target', () => {
    expect(
      targetMatchesSelection(
        { notebookId: 'nb-1', sectionId: 'sec-1', pageId: 'pg-1' },
        { activeNotebookId: 'nb-1', activeSectionId: 'sec-1', activePageId: 'pg-1' },
      ),
    ).toBe(true)
    expect(
      targetMatchesSelection(
        { notebookId: 'nb-1', sectionId: 'sec-1' },
        { activeNotebookId: 'nb-1', activeSectionId: 'sec-1', activePageId: 'pg-2' },
      ),
    ).toBe(true)
  })

  it('detects hierarchy changes even when the page id is unchanged', () => {
    expect(
      targetMatchesSelection(
        { notebookId: 'nb-2', sectionId: 'sec-1', pageId: 'pg-1' },
        { activeNotebookId: 'nb-1', activeSectionId: 'sec-1', activePageId: 'pg-1' },
      ),
    ).toBe(false)
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

describe('getNavigationTargetStatus', () => {
  it('waits for notebooks before deciding whether the target exists', () => {
    expect(getNavigationTargetStatus({
      target: { notebookId: 'nb-1' },
      notebooks: [],
      notebooksLoading: true,
    })).toEqual({ type: 'wait' })
  })

  it('marks a missing notebook after notebook loading completes', () => {
    expect(getNavigationTargetStatus({
      target: { notebookId: 'nb-missing' },
      notebooks,
    })).toEqual({ type: 'missing' })
  })

  it('waits for sections before validating a section target', () => {
    expect(getNavigationTargetStatus({
      target: { notebookId: 'nb-2', sectionId: 'sec-2' },
      notebooks,
      sections: [],
      sectionsLoading: true,
    })).toEqual({ type: 'wait' })
  })

  it('validates notebook-only and section-only targets as complete units', () => {
    expect(getNavigationTargetStatus({
      target: { notebookId: 'nb-1' },
      notebooks,
    })).toEqual({ type: 'ready' })

    expect(getNavigationTargetStatus({
      target: { notebookId: 'nb-2', sectionId: 'sec-2' },
      notebooks,
      sections,
    })).toEqual({ type: 'ready' })
  })

  it('rejects a section that does not belong to the target notebook', () => {
    expect(getNavigationTargetStatus({
      target: { notebookId: 'nb-1', sectionId: 'sec-2' },
      notebooks,
      sections,
    })).toEqual({ type: 'missing' })
  })

  it('waits when target page metadata is not loaded yet', () => {
    const target = { notebookId: 'nb-2', sectionId: 'sec-2', pageId: 'pg-2' }

    expect(getNavigationTargetStatus({
      target,
      notebooks,
      sections,
      sectionPageCache: {},
    })).toEqual({ type: 'wait' })

    expect(getNavigationTargetStatus({
      target,
      notebooks,
      sections,
      sectionPageCache: { 'sec-2': { status: 'loading', pages: [], error: null } },
    })).toEqual({ type: 'wait' })
  })

  it('marks failed or absent page metadata as missing', () => {
    const target = { notebookId: 'nb-2', sectionId: 'sec-2', pageId: 'pg-2' }

    expect(getNavigationTargetStatus({
      target,
      notebooks,
      sections,
      sectionPageCache: { 'sec-2': { status: 'error', pages: [], error: 'network error' } },
    })).toEqual({ type: 'missing' })

    expect(getNavigationTargetStatus({
      target: { ...target, pageId: 'pg-missing' },
      notebooks,
      sections,
      sectionPageCache: loadedSectionPageCache,
    })).toEqual({ type: 'missing' })
  })

  it('returns ready only after the complete page hierarchy is available', () => {
    expect(getNavigationTargetStatus({
      target: { notebookId: 'nb-1', sectionId: 'sec-1', pageId: 'pg-1' },
      notebooks,
      sections,
      sectionPageCache: loadedSectionPageCache,
    })).toEqual({ type: 'ready' })
  })
})
