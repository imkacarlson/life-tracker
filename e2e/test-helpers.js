// Shared test helpers for self-contained E2E seed data.
// Each test creates its own notebooks/sections/pages in beforeAll
// and the isolateSupabaseData fixture in fixtures.js handles cleanup.

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import path from 'path'

config({ path: path.resolve(process.cwd(), '.env.local') })
config({ path: path.resolve(process.cwd(), '.env.test'), override: true })

let cached = null

/**
 * Returns an authenticated Supabase client and the test user's ID.
 * Caches the result so multiple test files don't re-authenticate.
 */
export const getSupabase = async () => {
  if (cached) return cached

  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  const email = process.env.TEST_USER_EMAIL
  const password = process.env.TEST_USER_PASSWORD
  if (!url || !key || !email || !password) {
    throw new Error(
      'Missing env vars for E2E seed data. Set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, TEST_USER_EMAIL, TEST_USER_PASSWORD.',
    )
  }

  const client = createClient(url, key)
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error

  const { data } = await client.auth.getUser()
  const userId = data?.user?.id
  if (!userId) throw new Error('Unable to resolve authenticated test user id')

  cached = { client, userId }
  return cached
}

/** Create a notebook and return the inserted row. */
export const createNotebook = async (client, userId, title, sortOrder = 0, type = 'tracker') => {
  const { data, error } = await client
    .from('notebooks')
    .insert({ user_id: userId, title, sort_order: sortOrder, type })
    .select()
    .single()
  if (error) throw error
  return data
}

/** Create a section and return the inserted row. */
export const createSection = async (client, userId, notebookId, title, sortOrder = 0) => {
  const { data, error } = await client
    .from('sections')
    .insert({ user_id: userId, notebook_id: notebookId, title, sort_order: sortOrder })
    .select()
    .single()
  if (error) throw error
  return data
}

/** Create a page and return the inserted row. */
export const createPage = async (client, userId, sectionId, title, content, sortOrder = 0) => {
  const { data, error } = await client
    .from('pages')
    .insert({ user_id: userId, section_id: sectionId, title, content, sort_order: sortOrder })
    .select()
    .single()
  if (error) throw error
  return data
}

/** Find the first section belonging to the test user. Throws if none exist. */
export const findFirstSection = async (client, userId) => {
  const { data: sections, error } = await client
    .from('sections')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
  if (error) throw error
  const sectionId = sections?.[0]?.id
  if (!sectionId) throw new Error('No section found for test seed data')
  return sectionId
}

/** Navigate to the app root (or a hash) and wait for auth + editor to be ready. */
export const waitForApp = async (page, hash = '/') => {
  await page.goto(hash)
  await page.waitForSelector('.app:not(.app-auth)', { timeout: 15000 })
}
