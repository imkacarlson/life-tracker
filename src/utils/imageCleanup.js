import { supabase } from '../lib/supabase'
import { collectStoragePaths } from './contentHelpers'

/**
 * Delete image files from Supabase Storage, but ONLY if no other page or
 * the daily template still references them. This prevents data loss when
 * images are shared across copied sections/pages.
 *
 * Fire-and-forget — errors are logged to the console but never surface to
 * the user. If the reference check fails, no images are deleted (safe default).
 */
export const deleteImagesFromStorage = async (candidatePaths) => {
  if (!candidatePaths || candidatePaths.length === 0) return
  try {
    // Query all pages and settings to find every image path still in use.
    // If either query fails, abort entirely — never delete when the reference
    // set is incomplete (safe default to avoid data loss).
    const allReferencedPaths = new Set()

    // Paginate pages query to handle accounts with >1000 pages.
    let pageOffset = 0
    const PAGE_SIZE = 1000
    while (true) {
      const { data, error } = await supabase
        .from('pages')
        .select('content')
        .order('id')
        .range(pageOffset, pageOffset + PAGE_SIZE - 1)
      if (error) {
        console.warn('Image cleanup aborted — failed to query pages:', error.message)
        return
      }
      for (const page of data ?? []) {
        try { collectStoragePaths(page.content, allReferencedPaths) } catch {}
      }
      if (!data || data.length < PAGE_SIZE) break
      pageOffset += PAGE_SIZE
    }

    // Also scan daily template settings for image references.
    const { data: settingsData, error: settingsError } = await supabase
      .from('settings')
      .select('daily_template_content')
    if (settingsError) {
      console.warn('Image cleanup aborted — failed to query settings:', settingsError.message)
      return
    }
    for (const row of settingsData ?? []) {
      try { collectStoragePaths(row.daily_template_content, allReferencedPaths) } catch {}
    }

    // Only delete paths that are truly unreferenced.
    const safeToDelete = candidatePaths.filter((p) => !allReferencedPaths.has(p))
    if (safeToDelete.length === 0) return

    await supabase.storage.from('tracker-images').remove(safeToDelete)
  } catch (err) {
    console.warn('Image cleanup failed (non-blocking):', err)
  }
}

/**
 * Compare old and new page content, returning storage paths that were removed.
 * Wrapped in try-catch so a malformed document never breaks the save pipeline.
 */
export const findRemovedImagePaths = (oldContent, newContent) => {
  try {
    const oldPaths = new Set()
    const newPaths = new Set()
    collectStoragePaths(oldContent, oldPaths)
    collectStoragePaths(newContent, newPaths)
    if (oldPaths.size === 0) return []
    return [...oldPaths].filter((p) => !newPaths.has(p))
  } catch (err) {
    console.warn('Image diff failed (non-blocking):', err)
    return []
  }
}

/**
 * Collect all image storage paths from an array of page rows.
 * Wrapped in try-catch so a malformed page never breaks deletion.
 */
export const collectAllImagePaths = (pages) => {
  const paths = new Set()
  for (const page of pages) {
    try {
      collectStoragePaths(page.content, paths)
    } catch (err) {
      console.warn('Image path collection failed for page', page.id, '(non-blocking):', err)
    }
  }
  return [...paths]
}
