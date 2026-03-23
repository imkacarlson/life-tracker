// Shared test helpers for self-contained E2E seed data.
// Each test creates its own notebooks/sections/pages in beforeAll
// and the isolateSupabaseData fixture in fixtures.js handles cleanup.

import { createClient } from '@supabase/supabase-js'
import { expect } from '@playwright/test'
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

/** Navigate to the app root (or a hash) and wait for auth + editor to be ready.
 *  Options:
 *    expectedText — if provided, also waits for this text to appear in the editor
 *
 *  Strategy: Load the app at "/" first (if not already loaded), then navigate
 *  to the target page by setting window.location.hash via evaluate(). This
 *  triggers the app's hashchange listener, which uses the fully-initialised
 *  navigateToHash path — avoiding the race condition that can occur on cold
 *  start between resolveNavHierarchy and loadNotebooks. It also handles
 *  same-hash re-navigation (Playwright treats page.goto to the same URL as
 *  a no-op) by clearing the hash first.
 */
export const waitForApp = async (page, hash = '/', { expectedText } = {}) => {
  // 1. Ensure the app is loaded and authenticated.
  const url = page.url()
  const isOnApp = url.includes('localhost:5173') && !url.includes('about:blank')
  if (!isOnApp) {
    await page.goto('/')
  }
  await page.waitForSelector('.app:not(.app-auth)', { timeout: 15000 })
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

  // 2. Navigate to the target hash via the hashchange listener.
  if (hash && hash !== '/') {
    const hashStr = hash.startsWith('/#') ? hash.slice(2) : hash.startsWith('#') ? hash.slice(1) : hash
    // Clear hash first so that re-navigating to the same page ID still fires
    // a hashchange event (empty → #pg=<id>).
    await page.evaluate(() => { window.location.hash = '' })
    await page.evaluate((h) => { window.location.hash = '#' + h }, hashStr)
  }

  // 3. Wait for the editor to show the expected content.
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })
  if (expectedText) {
    await expect(page.locator('.ProseMirror')).toContainText(expectedText, { timeout: 10000 })
  }
}
