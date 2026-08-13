/**
 * Translate a persisted page row into the naming used by application code.
 * Database column names stay at the Supabase boundary instead of leaking into
 * components and hooks.
 */
export function toClientPage(page) {
  if (!page) return page

  const { is_tracker_page: persistedDailySource, ...clientPage } = page
  return {
    ...clientPage,
    isDailySource: Boolean(clientPage.isDailySource ?? persistedDailySource),
  }
}
