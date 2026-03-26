import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock supabase before importing the module under test so the module-level
// pageHierarchyCache is created inside a controlled environment.
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}))

import { resolveNavHierarchy, clearNavHierarchyCache } from '../resolveNavHierarchy'
import { supabase } from '../../lib/supabase'

const mockPageQuery = (data, error = null) => {
  supabase.from.mockReturnValueOnce({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  })
}

describe('resolveNavHierarchy cache', () => {
  beforeEach(() => {
    clearNavHierarchyCache()
    vi.clearAllMocks()
  })

  it('calls Supabase on a cache miss and returns the hierarchy', async () => {
    mockPageQuery({
      id: 'page-1',
      section_id: 'sec-1',
      sections: { id: 'sec-1', notebook_id: 'nb-1' },
    })

    const result = await resolveNavHierarchy({ pageId: 'page-1' })

    expect(result).toEqual({ notebookId: 'nb-1', sectionId: 'sec-1', pageId: 'page-1', blockId: null })
    expect(supabase.from).toHaveBeenCalledTimes(1)
  })

  it('returns cached result on a second call without hitting Supabase', async () => {
    mockPageQuery({
      id: 'page-1',
      section_id: 'sec-1',
      sections: { id: 'sec-1', notebook_id: 'nb-1' },
    })

    // First call — cache miss, hits Supabase
    await resolveNavHierarchy({ pageId: 'page-1' })
    expect(supabase.from).toHaveBeenCalledTimes(1)

    // Second call — cache hit, Supabase NOT called
    const result = await resolveNavHierarchy({ pageId: 'page-1' })
    expect(supabase.from).toHaveBeenCalledTimes(1) // still 1
    expect(result).toEqual({ notebookId: 'nb-1', sectionId: 'sec-1', pageId: 'page-1', blockId: null })
  })

  it('returns null and does not cache when Supabase returns an error', async () => {
    mockPageQuery(null, new Error('network error'))

    const result = await resolveNavHierarchy({ pageId: 'page-1' })
    expect(result).toBeNull()

    // After an error, a subsequent call should hit Supabase again (not cached)
    mockPageQuery({
      id: 'page-1',
      section_id: 'sec-1',
      sections: { id: 'sec-1', notebook_id: 'nb-1' },
    })
    const retry = await resolveNavHierarchy({ pageId: 'page-1' })
    expect(supabase.from).toHaveBeenCalledTimes(2)
    expect(retry?.notebookId).toBe('nb-1')
  })

  it('clearNavHierarchyCache forces a fresh Supabase call', async () => {
    mockPageQuery({
      id: 'page-1',
      section_id: 'sec-1',
      sections: { id: 'sec-1', notebook_id: 'nb-1' },
    })
    await resolveNavHierarchy({ pageId: 'page-1' })
    expect(supabase.from).toHaveBeenCalledTimes(1)

    clearNavHierarchyCache()

    mockPageQuery({
      id: 'page-1',
      section_id: 'sec-1',
      sections: { id: 'sec-1', notebook_id: 'nb-1' },
    })
    await resolveNavHierarchy({ pageId: 'page-1' })
    expect(supabase.from).toHaveBeenCalledTimes(2)
  })

  it('preserves blockId through cache hits', async () => {
    mockPageQuery({
      id: 'page-1',
      section_id: 'sec-1',
      sections: { id: 'sec-1', notebook_id: 'nb-1' },
    })

    await resolveNavHierarchy({ pageId: 'page-1' })

    // Cache hit with a blockId should pass it through
    const result = await resolveNavHierarchy({ pageId: 'page-1', blockId: 'block-42' })
    expect(result).toEqual({ notebookId: 'nb-1', sectionId: 'sec-1', pageId: 'page-1', blockId: 'block-42' })
  })
})
