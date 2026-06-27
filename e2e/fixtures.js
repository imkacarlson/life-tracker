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
    async ({ baseURL }, provide, testInfo) => {
      void baseURL
      if (testInfo.project.name === 'setup') {
        await provide()
        return
      }

      const snapshot = await readSnapshot()
      try {
        await provide()
      } finally {
        // The app's autosave debounce is 2 000 ms.  Wait at least that long
        // before polling so the debounce has a chance to fire.  Then poll the
        // DB every 500 ms until two consecutive reads match — meaning any
        // in-flight save has landed.  Ignore query errors (treat as "changed").
        await new Promise((r) => setTimeout(r, 2000))
        const supabase = await getSupabaseClient()
        const userId = snapshot.userId
        let prev = null
        const deadline = Date.now() + 3000
        while (Date.now() < deadline) {
          const { data, error } = await supabase
            .from('pages')
            .select('id,content,title')
            .eq('user_id', userId)
          if (!error) {
            const snap = JSON.stringify(data ?? [])
            if (prev !== null && snap === prev) break
            prev = snap
          }
          await new Promise((r) => setTimeout(r, 500))
        }
        await restoreSnapshot(snapshot, getProtectedSeedSnapshot())
      }
    },
    { auto: true },
  ],
})

export { expect }
