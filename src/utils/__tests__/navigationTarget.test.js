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

describe('getNavigationApplyStep', () => {
  const notebooks = [{ id: 'nb-1' }, { id: 'nb-2' }]
  const sections = [
    { id: 'sec-1', notebook_id: 'nb-1' },
    { id: 'sec-2', notebook_id: 'nb-2' },
  ]
  const trackers = [
    { id: 'pg-1', section_id: 'sec-1' },
    { id: 'pg-2', section_id: 'sec-2' },
  ]

  it('applies navigation in notebook, section, then page order', () => {
    const target = { notebookId: 'nb-2', sectionId: 'sec-2', pageId: 'pg-2' }

    expect(getNavigationApplyStep({ target, notebooks, sections, trackers, activeNotebookId: 'nb-1' }))
      .toEqual({ type: 'notebook', id: 'nb-2' })

    expect(getNavigationApplyStep({
      target,
      notebooks,
      sections,
      trackers,
      activeNotebookId: 'nb-2',
      activeSectionId: 'sec-1',
    })).toEqual({ type: 'section', id: 'sec-2' })

    expect(getNavigationApplyStep({
      target,
      notebooks,
      sections,
      trackers,
      activeNotebookId: 'nb-2',
      activeSectionId: 'sec-2',
      activeTrackerId: 'pg-1',
      loadedTrackerSectionId: 'sec-2',
    })).toEqual({ type: 'page', id: 'pg-2' })
  })

  it('waits for page data before treating a resolved page target as missing', () => {
    expect(getNavigationApplyStep({
      target: { notebookId: 'nb-2', sectionId: 'sec-2', pageId: 'pg-3' },
      notebooks,
      sections,
      trackers,
      activeNotebookId: 'nb-2',
      activeSectionId: 'sec-2',
      dataLoading: true,
      loadedTrackerSectionId: 'sec-2',
    })).toEqual({ type: 'wait' })
  })

  it('waits for the target section page data instead of using stale trackers', () => {
    expect(getNavigationApplyStep({
      target: { notebookId: 'nb-2', sectionId: 'sec-2', pageId: 'pg-2' },
      notebooks,
      sections,
      trackers: [{ id: 'pg-1', section_id: 'sec-1' }],
      activeNotebookId: 'nb-2',
      activeSectionId: 'sec-2',
      activeTrackerId: 'pg-1',
      dataLoading: false,
      loadedTrackerSectionId: 'sec-1',
    })).toEqual({ type: 'wait' })
  })

  it('treats a page as missing only after the target section has loaded', () => {
    expect(getNavigationApplyStep({
      target: { notebookId: 'nb-2', sectionId: 'sec-2', pageId: 'pg-missing' },
      notebooks,
      sections,
      trackers,
      activeNotebookId: 'nb-2',
      activeSectionId: 'sec-2',
      loadedTrackerSectionId: 'sec-2',
    })).toEqual({ type: 'missing' })
  })
})
