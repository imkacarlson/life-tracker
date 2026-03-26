import { supabase } from '../lib/supabase'

// Cache resolved page → hierarchy so that navigating back to a visited page
// never requires a Supabase round-trip. On mobile, each round-trip adds
// 200-800ms and can fail silently, causing navigateToHash to drop the navigation.
// Keyed by pageId; values are { notebookId, sectionId, pageId }.
// Cleared on sign-out via clearNavHierarchyCache().
const pageHierarchyCache = new Map()

export const clearNavHierarchyCache = () => pageHierarchyCache.clear()

/**
 * Resolves a deep-link target into the full notebook/section/page hierarchy.
 * Returns null when the target cannot be resolved.
 */
export const resolveNavHierarchy = async ({ notebookId = null, sectionId = null, pageId = null, blockId = null }) => {
  if (pageId && sectionId && notebookId) {
    return { notebookId, sectionId, pageId, blockId: blockId ?? null }
  }
  if (sectionId && notebookId) {
    return { notebookId, sectionId, pageId: null, blockId: null }
  }

  if (pageId) {
    // Return from cache if this page's hierarchy was already resolved this session.
    const cached = pageHierarchyCache.get(pageId)
    if (cached) {
      return { ...cached, blockId: blockId ?? null }
    }

    const { data, error } = await supabase
      .from('pages')
      .select('id, section_id, sections!inner(id, notebook_id)')
      .eq('id', pageId)
      .maybeSingle()

    if (error || !data?.section_id) {
      return null
    }

    const pageSection = Array.isArray(data.sections) ? data.sections[0] : data.sections
    const resolvedNotebookId = pageSection?.notebook_id ?? null

    if (!resolvedNotebookId) {
      return null
    }

    const result = {
      notebookId: resolvedNotebookId,
      sectionId: data.section_id,
      pageId,
    }
    pageHierarchyCache.set(pageId, result)

    return { ...result, blockId: blockId ?? null }
  }

  if (sectionId) {
    const { data, error } = await supabase
      .from('sections')
      .select('id, notebook_id')
      .eq('id', sectionId)
      .maybeSingle()

    if (error || !data?.notebook_id) {
      return null
    }

    return {
      notebookId: data.notebook_id,
      sectionId,
      pageId: null,
      blockId: null,
    }
  }

  if (notebookId) {
    return {
      notebookId,
      sectionId: null,
      pageId: null,
      blockId: null,
    }
  }

  return null
}
