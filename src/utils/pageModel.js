/**
 * Translate a persisted page row into the naming used by application code.
 * Database column names stay at the Supabase boundary instead of leaking into
 * components and hooks.
 */
export function toClientPage(page) {
  if (!page) return page

  const {
    is_tracker_page: persistedDailySource,
    library_role: persistedLibraryRole,
    ...clientPage
  } = page
  return {
    ...clientPage,
    isDailySource: Boolean(clientPage.isDailySource ?? persistedDailySource),
    // null for every page outside a Library notebook. See
    // 20260820151116_add_library_notebook_type.sql for the value set.
    libraryRole: clientPage.libraryRole ?? persistedLibraryRole ?? null,
  }
}
