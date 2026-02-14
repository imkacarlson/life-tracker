import { supabase } from '../lib/supabase'

/**
 * Resolves a deep-link target into the full notebook/section/page hierarchy.
 * Returns null when the target cannot be resolved.
 */
export const resolveNavHierarchy = async ({ notebookId = null, sectionId = null, pageId = null, blockId = null }) => {
  if (pageId) {
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

    return {
      notebookId: resolvedNotebookId,
      sectionId: data.section_id,
      pageId,
      blockId: blockId ?? null,
    }
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
