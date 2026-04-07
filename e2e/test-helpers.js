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

const findFallbackPageHash = async () => {
  const { client, userId } = await getSupabase()
  const { data: pageRow, error: pageError } = await client
    .from('pages')
    .select('id, section_id')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true, nullsLast: true })
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (pageError) throw pageError
  if (!pageRow) return null

  const { data: sectionRow, error: sectionError } = await client
    .from('sections')
    .select('id, notebook_id')
    .eq('id', pageRow.section_id)
    .maybeSingle()

  if (sectionError) throw sectionError
  if (!sectionRow?.notebook_id) return null

  return `/#nb=${sectionRow.notebook_id}&sec=${sectionRow.id}&pg=${pageRow.id}`
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
  let expectedPageTitle = null
  if (hash && hash !== '/') {
    const hashStr = hash.startsWith('/#') ? hash.slice(2) : hash.startsWith('#') ? hash.slice(1) : hash
    const params = new URLSearchParams(hashStr)
    const pageId = params.get('pg')
    if (pageId) {
      const { client } = await getSupabase()
      const { data: pageRow } = await client.from('pages').select('title').eq('id', pageId).maybeSingle()
      expectedPageTitle = pageRow?.title ?? null
    }
  }

  // 1. Always reload the app shell for each test. The DB snapshot is restored
  // between tests, so reusing an already-mounted SPA can leave stale notebooks,
  // sections, or pages in memory from the previous test run.
  await page.goto('/')
  await page.waitForSelector('.app:not(.app-auth)', { timeout: 15000 })

  // 2. Navigate to the target hash via the hashchange listener.
  if (hash && hash !== '/') {
    const hashStr = hash.startsWith('/#') ? hash.slice(2) : hash.startsWith('#') ? hash.slice(1) : hash
    // Clear hash first so that re-navigating to the same page ID still fires
    // a hashchange event (empty → #pg=<id>).
    await page.evaluate(() => { window.location.hash = '' })
    await page.evaluate((h) => { window.location.hash = '#' + h }, hashStr)
  }

  // 3. Wait for the editor to show the expected content.
  try {
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })
    if (expectedPageTitle) {
      await expect(page.locator('.title-input')).toHaveValue(expectedPageTitle, { timeout: 10000 })
    }
    if (expectedText) {
      await expect(page.locator('.ProseMirror')).toContainText(expectedText, { timeout: 10000 })
    }
  } catch (error) {
    if (!hash || hash === '/') {
      const fallbackHash = await findFallbackPageHash()
      if (!fallbackHash) throw error
      await page.goto(fallbackHash)
      await page.waitForSelector('.app:not(.app-auth)', { timeout: 15000 })
      await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })
      return
    }

    // Fallback: if hashchange navigation misses the target page, reload
    // directly to the hash URL and wait again. This keeps tests deterministic
    // without depending on a single navigation path.
    await page.goto(hash)
    await page.waitForSelector('.app:not(.app-auth)', { timeout: 15000 })
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })
    if (expectedPageTitle) {
      await expect(page.locator('.title-input')).toHaveValue(expectedPageTitle, { timeout: 10000 })
    }
    if (expectedText) {
      await expect(page.locator('.ProseMirror')).toContainText(expectedText, { timeout: 10000 })
    }
  }
}

/**
 * On touch/mobile the toolbar may start collapsed. Expand it when a test needs
 * toolbar-only actions so the test matches the user-visible interaction.
 */
export const ensureToolbarExpanded = async (page) => {
  const toolbar = page.locator('.toolbar')
  await expect(toolbar).toBeVisible({ timeout: 10000 })

  if (await toolbar.getAttribute('data-expanded') !== 'true') {
    const expandToggle = page.getByTestId('toolbar-expand-toggle')
    await expect(expandToggle).toBeVisible({ timeout: 5000 })
    await expandToggle.click()
  }

  await expect(toolbar).toHaveAttribute('data-expanded', 'true', { timeout: 5000 })
}
