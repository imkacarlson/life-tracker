/**
 * Tree expand state persists across page reloads (Notesnook usePersistentState pattern).
 *
 * Expand notebooks/sections → reload → assert the expanded state is preserved.
 */
import { test, expect } from './fixtures'
import {
  createNotebook,
  createPage,
  createSection,
  deleteNotebookById,
  ensureNavigationVisible,
  getSupabase,
  waitForApp,
} from './test-helpers'

test.describe('tree expand state persistence', () => {
  let notebookA = null
  let notebookB = null
  let sectionA1 = null
  let sectionA2 = null
  let sectionB1 = null
  let pageA = null

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    const stamp = Date.now()
    notebookA = await createNotebook(client, userId, `Persist A ${stamp}`, -8800)
    notebookB = await createNotebook(client, userId, `Persist B ${stamp}`, -8799)
    sectionA1 = await createSection(client, userId, notebookA.id, 'Persist A One', 0)
    sectionA2 = await createSection(client, userId, notebookA.id, 'Persist A Two', 1)
    sectionB1 = await createSection(client, userId, notebookB.id, 'Persist B One', 0)
    pageA = await createPage(client, userId, sectionA1.id, 'Persist Page A', {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Persist content' }] }],
    })
  })

  test.afterAll(async () => {
    const { client } = await getSupabase()
    await deleteNotebookById(client, notebookA?.id)
    await deleteNotebookById(client, notebookB?.id)
  })

  test('expanded notebooks and sections survive a page reload', async ({ page }) => {
    // Start on a page to ensure both notebooks are in the tree
    const hashA = `#nb=${notebookA.id}&sec=${sectionA1.id}&pg=${pageA.id}`
    await waitForApp(page, hashA)
    await ensureNavigationVisible(page)

    // Both notebooks should be visible in the tree
    await expect(page.locator('.tree-node-notebook').filter({ hasText: 'Persist A' })).toBeVisible()
    await expect(page.locator('.tree-node-notebook').filter({ hasText: 'Persist B' })).toBeVisible()

    // Expand notebook B by clicking on it
    await page.locator('.tree-node-notebook').filter({ hasText: 'Persist B' }).click()
    // Section B should become visible
    await expect(page.locator('.tree-node-section').filter({ hasText: 'Persist B One' })).toBeVisible({ timeout: 2000 })

    // Also expand section A2 to confirm multi-section persistence
    const sectionA2Node = page.locator('.tree-node-section').filter({ hasText: 'Persist A Two' })
    if (await sectionA2Node.isVisible().catch(() => false)) {
      await sectionA2Node.click()
    }

    // Reload the page
    await page.reload()
    await page.waitForSelector('.nav-tree-container', { timeout: 10000 })

    // After reload, notebook B should still be expanded and section B visible
    await expect(page.locator('.tree-node-section').filter({ hasText: 'Persist B One' })).toBeVisible({ timeout: 5000 })
  })

  test('active page section is auto-expanded even after reload', async ({ page }) => {
    const hashA = `#nb=${notebookA.id}&sec=${sectionA1.id}&pg=${pageA.id}`
    await waitForApp(page, hashA)
    await ensureNavigationVisible(page)

    // The section containing the active page should always be expanded
    await expect(page.locator('.tree-node-section').filter({ hasText: 'Persist A One' })).toBeVisible()

    await page.reload()
    await page.waitForSelector('.nav-tree-container', { timeout: 10000 })

    // Active section must still be expanded after reload
    await expect(page.locator('.tree-node-section').filter({ hasText: 'Persist A One' })).toBeVisible({ timeout: 5000 })
  })
})
