/* global process */
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
const TRACKER_IMAGES_BUCKET = 'tracker-images'
const WORKSPACE_SELECTOR = '.workspace'
const NOTEBOOK_NODE_SELECTOR = '.tree-node-notebook'
const EDITOR_SELECTOR = '.ProseMirror'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const protectedSeedRows = {
  notebooks: new Map(),
  sections: new Map(),
  pages: new Map(),
}

const clone = (value) => JSON.parse(JSON.stringify(value ?? null))

export const getProtectedSeedSnapshot = () => ({
  notebooks: Array.from(protectedSeedRows.notebooks.values()).map(clone),
  sections: Array.from(protectedSeedRows.sections.values()).map(clone),
  pages: Array.from(protectedSeedRows.pages.values()).map(clone),
})

const protectSeedRow = (table, row) => {
  if (!row?.id) return
  protectedSeedRows[table].set(row.id, clone(row))
}

const forgetProtectedNotebook = (notebookId) => {
  if (!notebookId) return
  protectedSeedRows.notebooks.delete(notebookId)

  const sectionIds = new Set()
  for (const [sectionId, section] of protectedSeedRows.sections) {
    if (section.notebook_id === notebookId) {
      sectionIds.add(sectionId)
      protectedSeedRows.sections.delete(sectionId)
    }
  }

  for (const [pageId, page] of protectedSeedRows.pages) {
    if (sectionIds.has(page.section_id)) {
      protectedSeedRows.pages.delete(pageId)
    }
  }
}

const waitForReadableRow = async (client, table, id, timeoutMs = 5000) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const { data, error } = await client
      .from(table)
      .select('id')
      .eq('id', id)
      .maybeSingle()

    if (error) throw error
    if (data?.id === id) return
    await sleep(100)
  }

  throw new Error(`Timed out waiting for ${table} row ${id} to become readable`)
}

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

export const countUserRows = async (client, userId, table) => {
  const { count, error } = await client
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)

  if (error) throw error
  return count ?? 0
}

export const listUserStoragePaths = async (client, userId, bucket = TRACKER_IMAGES_BUCKET) => {
  const paths = []
  let offset = 0

  while (true) {
    let response = null
    let lastError = null

    for (let attempt = 0; attempt < 5; attempt += 1) {
      response = await client.storage
        .from(bucket)
        .list(userId, {
          limit: 1000,
          offset,
          sortBy: { column: 'name', order: 'asc' },
        })

      if (!response.error) {
        lastError = null
        break
      }

      lastError = response.error
      await sleep(250 * (attempt + 1))
    }

    if (lastError) throw lastError

    const { data } = response

    const files = (data ?? []).filter((entry) => entry.name && entry.id)
    for (const file of files) {
      paths.push(`${userId}/${file.name}`)
    }

    if (!data || data.length < 1000) break
    offset += data.length
  }

  return paths
}

export const countUserStorageObjects = async (client, userId, bucket = TRACKER_IMAGES_BUCKET) => {
  const paths = await listUserStoragePaths(client, userId, bucket)
  return paths.length
}

export const purgeTestUserData = async (
  client,
  userId,
  { purgeSettings = true, purgeStorage = true, bucket = TRACKER_IMAGES_BUCKET } = {},
) => {
  if (!client || !userId) {
    throw new Error('purgeTestUserData requires an authenticated client and user id')
  }

  if (purgeStorage) {
    const storagePaths = await listUserStoragePaths(client, userId, bucket)
    for (let index = 0; index < storagePaths.length; index += 100) {
      const chunk = storagePaths.slice(index, index + 100)
      let lastError = null
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const { error } = await client.storage.from(bucket).remove(chunk)
        if (!error) {
          lastError = null
          break
        }
        lastError = error
        await sleep(250 * (attempt + 1))
      }
      if (lastError) throw lastError
    }
  }

  if (purgeSettings) {
    const { error } = await client.from('settings').delete().eq('user_id', userId)
    if (error) throw error
  }

  // Delete from leaf to root so cleanup still works if cascade behavior changes.
  const { error: pagesError } = await client.from('pages').delete().eq('user_id', userId)
  if (pagesError) throw pagesError

  const { error: sectionsError } = await client.from('sections').delete().eq('user_id', userId)
  if (sectionsError) throw sectionsError

  const { error: notebooksError } = await client.from('notebooks').delete().eq('user_id', userId)
  if (notebooksError) throw notebooksError
}

/** Create a notebook and return the inserted row.
 *  Use an early sort order by default so fresh E2E notebooks remain visible
 *  even if the test account has accumulated older rows.
 */
export const createNotebook = async (
  client,
  userId,
  title,
  sortOrder = -Math.floor(Date.now() / 1000),
  type = 'tracker',
  options = {},
) => {
  if (typeof sortOrder === 'object' && sortOrder !== null) {
    options = sortOrder
    sortOrder = -Math.floor(Date.now() / 1000)
  }
  if (typeof type === 'object' && type !== null) {
    options = type
    type = 'tracker'
  }

  const { data, error } = await client
    .from('notebooks')
    .insert({ user_id: userId, title, sort_order: sortOrder, type })
    .select()
    .single()
  if (error) throw error
  await waitForReadableRow(client, 'notebooks', data.id)
  if (options.preserveForSuite !== false) protectSeedRow('notebooks', data)
  return data
}

/** Delete a notebook and rely on DB cascade rules to remove sections/pages. */
export const deleteNotebookById = async (client, notebookId) => {
  if (!client || !notebookId) return
  forgetProtectedNotebook(notebookId)
  const { error } = await client.from('notebooks').delete().eq('id', notebookId)
  if (error) throw error
}

/** Create a section and return the inserted row. */
export const createSection = async (client, userId, notebookId, title, sortOrder = 0) => {
  const { data, error } = await client
    .from('sections')
    .insert({ user_id: userId, notebook_id: notebookId, title, sort_order: sortOrder })
    .select()
    .single()
  if (error) throw error
  await waitForReadableRow(client, 'sections', data.id)
  if (protectedSeedRows.notebooks.has(notebookId)) protectSeedRow('sections', data)
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
  await waitForReadableRow(client, 'pages', data.id)
  if (protectedSeedRows.sections.has(sectionId)) protectSeedRow('pages', data)
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

const resolveTreeTitlesFromHash = async (hash) => {
  if (!hash || hash === '/') return null

  const hashStr = hash.startsWith('/#') ? hash.slice(2) : hash.startsWith('#') ? hash.slice(1) : hash
  const params = new URLSearchParams(hashStr)
  let notebookId = params.get('nb')
  let sectionId = params.get('sec')
  const pageId = params.get('pg')

  const { client } = await getSupabase()

  let pageTitle = null
  let sectionTitle = null
  let notebookTitle = null

  if (pageId) {
    const { data: pageRow, error: pageError } = await client
      .from('pages')
      .select('title, section_id')
      .eq('id', pageId)
      .maybeSingle()

    if (pageError) throw pageError
    pageTitle = pageRow?.title ?? null
    sectionId = sectionId || pageRow?.section_id || null
  }

  if (sectionId) {
    const { data: sectionRow, error: sectionError } = await client
      .from('sections')
      .select('title, notebook_id')
      .eq('id', sectionId)
      .maybeSingle()

    if (sectionError) throw sectionError
    sectionTitle = sectionRow?.title ?? null
    notebookId = notebookId || sectionRow?.notebook_id || null
  }

  if (notebookId) {
    const { data: notebookRow, error: notebookError } = await client
      .from('notebooks')
      .select('title')
      .eq('id', notebookId)
      .maybeSingle()

    if (notebookError) throw notebookError
    notebookTitle = notebookRow?.title ?? null
  }

  if (!notebookTitle && !sectionTitle && !pageTitle) return null
  const fullHash = [
    notebookId ? `nb=${notebookId}` : null,
    sectionId ? `sec=${sectionId}` : null,
    pageId ? `pg=${pageId}` : null,
  ].filter(Boolean).join('&')

  return {
    notebookId,
    sectionId,
    pageId,
    notebookTitle,
    sectionTitle,
    pageTitle,
    fullHash: fullHash ? `/#${fullHash}` : null,
  }
}

const waitForWorkspaceReady = async (page) => {
  await page.waitForSelector(WORKSPACE_SELECTOR, { timeout: 30000 })
  await page.waitForSelector(NOTEBOOK_NODE_SELECTOR, { timeout: 30000 })
}

const isTreeItemActive = async (locator) => {
  try {
    return await locator.evaluate((el) =>
      el.classList.contains('active') || el.getAttribute('aria-current') === 'page',
    )
  } catch {
    return false
  }
}

const clickTreeItemByTitle = async (page, selector, title, options) => {
  const locator = page.locator(selector, { hasText: title }).first()
  if (!(await locator.count())) return false

  if (await isTreeItemActive(locator)) {
    await expect(locator).toBeVisible({ timeout: 10000 })
    return true
  }

  await clickNavigationItem(page, locator, options)
  return true
}

const navigateViaHashChange = async (page, hash) => {
  if (!hash || hash === '/') return
  const hashStr = hash.startsWith('/#') ? hash.slice(2) : hash.startsWith('#') ? hash.slice(1) : hash
  // Clear hash first so that re-navigating to the same page ID still fires
  // a hashchange event (empty → #pg=<id>).
  await page.evaluate(() => { window.location.hash = '' })
  await page.evaluate((h) => { window.location.hash = '#' + h }, hashStr)
}

const waitForExpectedEditor = async (
  page,
  { expectedPageTitle = null, expectedText = null, timeout = 10000 } = {},
) => {
  await page.waitForSelector(EDITOR_SELECTOR, { timeout })
  if (expectedPageTitle) {
    await expect(page.locator('.title-input')).toHaveValue(expectedPageTitle, { timeout })
  }
  if (expectedText) {
    await expect(page.locator('.ProseMirror')).toContainText(expectedText, { timeout })
  }
}

const waitForExpectedNavigationTarget = async (page, treeTitles) => {
  if (!treeTitles) return

  if (treeTitles.notebookTitle) {
    await expect(page.locator('.tree-node-notebook', { hasText: treeTitles.notebookTitle }).first()).toBeVisible({
      timeout: 10000,
    })
  }
  if (treeTitles.sectionTitle) {
    await expect(page.locator('.tree-node-section', { hasText: treeTitles.sectionTitle }).first()).toBeVisible({
      timeout: 10000,
    })
  }
  if (treeTitles.pageTitle) {
    await expect(page.locator('.tree-node-page', { hasText: treeTitles.pageTitle }).first()).toBeVisible({
      timeout: 10000,
    })
  }
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
export const waitForApp = async (page, hash = '/', { expectedText, waitForEditor = true } = {}) => {
  let expectedPageTitle = null
  let treeTitles = null
  let navigationHash = hash
  if (hash && hash !== '/') {
    const hashStr = hash.startsWith('/#') ? hash.slice(2) : hash.startsWith('#') ? hash.slice(1) : hash
    const params = new URLSearchParams(hashStr)
    const pageId = params.get('pg')
    treeTitles = await resolveTreeTitlesFromHash(hash)
    navigationHash = treeTitles?.fullHash ?? hash
    if (pageId) expectedPageTitle = treeTitles?.pageTitle ?? null
  }

  const loadRootWorkspace = async () => {
    // Always reload the app root for each test. The DB snapshot is restored
    // between tests, so reusing an already-mounted SPA can leave stale
    // notebooks, sections, or pages in memory from the previous test run.
    await page.goto('/')
    await waitForWorkspaceReady(page)
  }

  try {
    await loadRootWorkspace()
    await navigateViaHashChange(page, navigationHash)
    if (!waitForEditor) {
      await waitForExpectedNavigationTarget(page, treeTitles)
      return
    }
    await waitForExpectedEditor(page, { expectedPageTitle, expectedText, timeout: 5000 })
  } catch (error) {
    if (!hash || hash === '/') {
      const fallbackHash = await findFallbackPageHash()
      if (!fallbackHash) throw error
      await loadRootWorkspace()
      await navigateViaHashChange(page, fallbackHash)
      await waitForExpectedEditor(page)
      return
    }

    await loadRootWorkspace()
    if (!waitForEditor) {
      await navigateViaHashChange(page, navigationHash)
      await waitForExpectedNavigationTarget(page, treeTitles)
      return
    }

    if (treeTitles) {
      await loadRootWorkspace()
      await ensureNavigationVisible(page)
      if (treeTitles.notebookTitle) {
        await clickTreeItemByTitle(page, '.tree-node-notebook', treeTitles.notebookTitle)
      }
      if (treeTitles.sectionTitle) {
        await clickTreeItemByTitle(page, '.tree-node-section', treeTitles.sectionTitle)
      }
      if (treeTitles.pageTitle) {
        await clickTreeItemByTitle(page, '.tree-node-page', treeTitles.pageTitle)
      }
      await waitForExpectedEditor(page, { expectedPageTitle, expectedText })
      return
    }

    await navigateViaHashChange(page, navigationHash)
    await waitForExpectedEditor(page, { expectedPageTitle, expectedText })
  }
}

export const ensureNavigationVisible = async (page) => {
  const drawer = page.locator('.nav-tree-container.open')
  const closeButton = page.getByRole('button', { name: 'Close navigation sidebar' })
  const openButton = page.getByRole('button', { name: 'Open navigation sidebar' })
  if (!(await closeButton.isVisible().catch(() => false)) && await openButton.isVisible().catch(() => false)) {
    await openButton.evaluate((el) => el.click())
  }

  if (await closeButton.isVisible().catch(() => false)) {
    await expect(drawer).toBeVisible({ timeout: 5000 })
  }
  await expect(page.getByRole('tree', { name: 'Notebook navigation' })).toBeVisible({
    timeout: 5000,
  })
}

export const ensureNavigationHidden = async (page) => {
  const backdrop = page.getByRole('button', { name: 'Close navigation drawer' })
  if (await backdrop.isVisible().catch(() => false)) {
    await backdrop.evaluate((el) => el.click())
    await expect(backdrop).toBeHidden({ timeout: 5000 })
    return
  }

  const closeButton = page.getByRole('button', { name: 'Close navigation sidebar' })
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.evaluate((el) => el.click())
    await expect(closeButton).toBeHidden({ timeout: 5000 })
  }
}

export const clickNavigationItem = async (page, locator, options) => {
  await ensureNavigationVisible(page)
  let lastError = null

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await expect(locator).toBeVisible({ timeout: 10000 })
      await locator.evaluate((el) => {
        el.scrollIntoView({ block: 'center', inline: 'nearest' })
      })
      await locator.click(options)
      return
    } catch (error) {
      lastError = error
      if (!/detached from the DOM/i.test(String(error))) {
        throw error
      }
    }
  }

  throw lastError
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

export const isElementStartInEditorSafeView = async (locator) =>
  locator.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const panel = el.closest('.editor-panel') ?? document.querySelector('.editor-panel')
    const panelRect = panel?.getBoundingClientRect()
    let safeTop = Math.max(0, panelRect?.top ?? 0)
    let safeBottom = Math.min(window.innerHeight, panelRect?.bottom ?? window.innerHeight)

    const toolbar = document.querySelector('.toolbar')
    const toolbarRect = toolbar?.getBoundingClientRect()
    if (toolbarRect && toolbarRect.height > 0) {
      const overlapsSafeBand = toolbarRect.bottom > safeTop && toolbarRect.top < safeBottom
      if (overlapsSafeBand) {
        const overlapsTopEdge = toolbarRect.top <= safeTop + 1
        const overlapsBottomEdge = toolbarRect.bottom >= safeBottom - 1
        if (overlapsTopEdge) safeTop = Math.max(safeTop, toolbarRect.bottom)
        if (overlapsBottomEdge) safeBottom = Math.min(safeBottom, toolbarRect.top)
      }
    }

    return rect.top >= safeTop - 1 && rect.top <= safeBottom - 1
  })
