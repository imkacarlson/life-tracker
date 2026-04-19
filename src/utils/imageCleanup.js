import { supabase } from '../lib/supabase'
import { collectStoragePaths } from './contentHelpers'
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
    // Retry a few times because a just-deleted page/section/notebook can still
    // appear in the first reference scan due to read-after-write lag.
    const MAX_ATTEMPTS = 6
    const RETRY_DELAY_MS = 500

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
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
      if (safeToDelete.length > 0) {
        await supabase.storage.from('tracker-images').remove(safeToDelete)
        return
      }

      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
      }
    }
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

/**
 * Collect image paths from pages returned by a query function that may observe
 * read-after-write lag. We merge pages seen across repeated reads so deleting a
 * freshly created section/notebook does not orphan images if the first read is incomplete.
 */
export const collectImagePathsForCleanup = async (
  loadPages,
  { attempts = 4, delayMs = 250 } = {},
) => {
  const pagesById = new Map()
  let stableNonEmptyReads = 0
  let previousPageCount = -1

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { data, error } = await loadPages()
    if (error) {
      return { imagePaths: collectAllImagePaths([...pagesById.values()]), error }
    }

    for (const page of data ?? []) {
      if (page?.id) {
        pagesById.set(page.id, page)
      }
    }

    const pageCount = pagesById.size
    if (pageCount > 0 && pageCount === previousPageCount) {
      stableNonEmptyReads += 1
    } else {
      stableNonEmptyReads = pageCount > 0 ? 1 : 0
    }
    previousPageCount = pageCount

    if (pageCount > 0 && stableNonEmptyReads >= 2) {
      break
    }

    if (attempt < attempts - 1) {
      await wait(delayMs)
    }
  }

  return { imagePaths: collectAllImagePaths([...pagesById.values()]), error: null }
}
