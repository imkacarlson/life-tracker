/* global process */
import { test as base, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import path from 'path'
import { getProtectedSeedSnapshot } from './test-helpers'

config({ path: path.resolve(process.cwd(), '.env.local') })
config({ path: path.resolve(process.cwd(), '.env.test'), override: true })

let supabaseClientPromise = null

const clone = (value) => JSON.parse(JSON.stringify(value ?? null))

const getSupabaseClient = async () => {
  if (supabaseClientPromise) return supabaseClientPromise
  supabaseClientPromise = (async () => {
    const supabaseUrl = process.env.VITE_SUPABASE_URL
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
    const email = process.env.TEST_USER_EMAIL
    const password = process.env.TEST_USER_PASSWORD
    if (!supabaseUrl || !supabaseAnonKey || !email || !password) {
      throw new Error(
        'Missing env vars for E2E data isolation. Set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, TEST_USER_EMAIL, TEST_USER_PASSWORD.',
      )
    }

    const client = createClient(supabaseUrl, supabaseAnonKey)
    const { error } = await client.auth.signInWithPassword({ email, password })
    if (error) throw error
    return client
  })()
  return supabaseClientPromise
}

const readUserId = async (supabase) => {
  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  const userId = data?.user?.id
  if (!userId) throw new Error('Unable to resolve authenticated test user id')
  return userId
}

const readSnapshot = async () => {
  const supabase = await getSupabaseClient()
  const userId = await readUserId(supabase)
  const [notebooksResult, sectionsResult, pagesResult] = await Promise.all([
    supabase
      .from('notebooks')
      .select('id,user_id,title,sort_order,type')
      .eq('user_id', userId),
    supabase
      .from('sections')
      .select('id,user_id,notebook_id,title,color,sort_order')
      .eq('user_id', userId),
    supabase
      .from('pages')
      .select('id,user_id,section_id,title,content,sort_order,is_tracker_page')
      .eq('user_id', userId),
  ])
  if (notebooksResult.error) throw notebooksResult.error
  if (sectionsResult.error) throw sectionsResult.error
  if (pagesResult.error) throw pagesResult.error

  return {
    userId,
    notebooks: clone(notebooksResult.data ?? []),
    sections: clone(sectionsResult.data ?? []),
    pages: clone(pagesResult.data ?? []),
  }
}

const mergeRowsById = (...rowLists) => Array.from(
  rowLists
    .flat()
    .reduce((rowsById, row) => {
      if (row?.id) rowsById.set(row.id, row)
      return rowsById
    }, new Map())
    .values(),
)

const restoreSnapshot = async (snapshot, protectedSnapshot = { notebooks: [], sections: [], pages: [] }) => {
  const supabase = await getSupabaseClient()
  const userId = snapshot.userId
  const targetSnapshot = {
    notebooks: mergeRowsById(snapshot.notebooks, protectedSnapshot.notebooks),
    sections: mergeRowsById(snapshot.sections, protectedSnapshot.sections),
    pages: mergeRowsById(snapshot.pages, protectedSnapshot.pages),
  }
  const [currentNotebooksResult, currentSectionsResult, currentPagesResult] = await Promise.all([
    supabase.from('notebooks').select('id').eq('user_id', userId),
    supabase.from('sections').select('id').eq('user_id', userId),
    supabase.from('pages').select('id').eq('user_id', userId),
  ])
  if (currentNotebooksResult.error) throw currentNotebooksResult.error
  if (currentSectionsResult.error) throw currentSectionsResult.error
  if (currentPagesResult.error) throw currentPagesResult.error

  const baselineNotebookIds = new Set(targetSnapshot.notebooks.map((row) => row.id))
  const baselineSectionIds = new Set(targetSnapshot.sections.map((row) => row.id))
  const baselinePageIds = new Set(targetSnapshot.pages.map((row) => row.id))

  const extraPageIds = (currentPagesResult.data ?? [])
    .map((row) => row.id)
    .filter((id) => !baselinePageIds.has(id))
  const extraSectionIds = (currentSectionsResult.data ?? [])
    .map((row) => row.id)
    .filter((id) => !baselineSectionIds.has(id))
  const extraNotebookIds = (currentNotebooksResult.data ?? [])
    .map((row) => row.id)
    .filter((id) => !baselineNotebookIds.has(id))

  // Remove test-created rows before restoring the baseline. Some app flows
  // delete sections/notebooks and rely on cascade behavior; running those
  // deletes after baseline upserts can race later tests into missing parents.
  if (extraPageIds.length > 0) {
    const { error } = await supabase.from('pages').delete().in('id', extraPageIds)
    if (error) throw error
  }
  if (extraSectionIds.length > 0) {
    const { error } = await supabase.from('sections').delete().in('id', extraSectionIds)
    if (error) throw error
  }
  if (extraNotebookIds.length > 0) {
    const { error } = await supabase.from('notebooks').delete().in('id', extraNotebookIds)
    if (error) throw error
  }

  if (targetSnapshot.notebooks.length > 0) {
    const { error } = await supabase.from('notebooks').upsert(targetSnapshot.notebooks, { onConflict: 'id' })
    if (error) throw error
  }
  if (targetSnapshot.sections.length > 0) {
    const { error } = await supabase.from('sections').upsert(targetSnapshot.sections, { onConflict: 'id' })
    if (error) throw error
  }
  if (targetSnapshot.pages.length > 0) {
    const { error } = await supabase.from('pages').upsert(targetSnapshot.pages, { onConflict: 'id' })
    if (error) throw error
  }
}

export const test = base.extend({
  isolateSupabaseData: [
    // `provide` is Playwright's fixture callback (passed positionally); it is
    // not React's `use` hook. Naming it `provide` avoids react-hooks/rules-of-hooks
    // false positives, and the named first param avoids no-empty-pattern.
    async ({ page }, provide, testInfo) => {
      if (testInfo.project.name === 'setup') {
        await provide()
        return
      }

      const snapshot = await readSnapshot()
      const pendingWrites = new Set()
      const isSupabaseWrite = (request) =>
        ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) &&
        request.url().includes('/rest/v1/')
      const trackWrite = (request) => {
        if (isSupabaseWrite(request)) pendingWrites.add(request)
      }
      const finishWrite = (request) => pendingWrites.delete(request)

      page.on('request', trackWrite)
      page.on('requestfinished', finishWrite)
      page.on('requestfailed', finishWrite)
      try {
        await provide()
      } finally {
        // Editing marks the page as Saving immediately, before the two-second
        // debounce starts. Wait on that observable state only when it exists;
        // read-only tests proceed directly to cleanup.
        const status = page.locator('.status-row')
        if (await status.count()) {
          const text = await status.textContent().catch(() => '')
          if (/Saving|Unsaved \(local\)/.test(text ?? '')) {
            await expect(status).not.toContainText(/Saving|Unsaved \(local\)/, { timeout: 6000 })
          }
        }

        // Also wait for direct create/delete/update requests that do not use
        // the editor's save status. This normally resolves immediately.
        await expect.poll(() => pendingWrites.size, { timeout: 5000 }).toBe(0)
        page.off('request', trackWrite)
        page.off('requestfinished', finishWrite)
        page.off('requestfailed', finishWrite)
        await restoreSnapshot(snapshot, getProtectedSeedSnapshot())
      }
    },
    { auto: true },
  ],
})

export { expect }
