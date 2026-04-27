/**
 * Verifies that expanding a non-active notebook immediately shows its sections
 * without requiring the user to click/select that notebook first.
 *
 * Before the fix, expanding a non-active notebook showed:
 *   "Select notebook to load sections."
 * After the fix, all sections are loaded eagerly and filtered client-side,
 * so any expanded notebook shows its children right away.
 */
import { test, expect } from './fixtures'
import {
  clickNavigationItem,
  createNotebook,
  createPage,
  createSection,
  deleteNotebookById,
  ensureNavigationVisible,
  getSupabase,
  waitForApp,
} from './test-helpers'

test.describe('notebook section hydration', () => {
  let notebookA = null
  let notebookB = null
  let sectionA = null
  let sectionB1 = null
  let sectionB2 = null
  let pageA = null

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()

    notebookA = await createNotebook(client, userId, `Hydration NbA ${Date.now()}`, -9998)
    notebookB = await createNotebook(client, userId, `Hydration NbB ${Date.now()}`, -9997)

    sectionA = await createSection(client, userId, notebookA.id, 'Section A-One', 0)
    sectionB1 = await createSection(client, userId, notebookB.id, 'Section B-One', 0)
    sectionB2 = await createSection(client, userId, notebookB.id, 'Section B-Two', 1)

    pageA = await createPage(client, userId, sectionA.id, 'Page A-One', {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Page A content' }] }],
    })
  })

  test.afterAll(async () => {
    const { client } = await getSupabase()
    await deleteNotebookById(client, notebookA?.id)
    await deleteNotebookById(client, notebookB?.id)
  })

  const chevronFor = (page, label) =>
    page.locator('.tree-node', { hasText: label }).locator('.tree-chevron').first()

  const rowFor = (page, label) =>
    page.locator('.tree-node', { hasText: label }).first()

  test('expanding a non-active notebook immediately shows its sections', async ({ page }) => {
    // Start in notebook A so A is the active notebook
    await waitForApp(page, `#nb=${notebookA.id}&sec=${sectionA.id}&pg=${pageA.id}`)
    await ensureNavigationVisible(page)

    // Notebook A is active and expanded — its section should be visible
    await expect(rowFor(page, notebookA.title)).toHaveClass(/active/)
    await expect(page.locator('.tree-node', { hasText: 'Section A-One' })).toBeVisible()

    // Notebook B is NOT active. Expand it via its chevron only (do not click the row).
    await clickNavigationItem(page, chevronFor(page, notebookB.title))
    await expect(rowFor(page, notebookB.title)).toHaveAttribute('aria-expanded', 'true')

    // Notebook A should still be active (we didn't select B)
    await expect(rowFor(page, notebookA.title)).toHaveClass(/active/)

    // Sections of notebook B should be immediately visible — no select-to-load gate
    await expect(page.locator('.tree-node', { hasText: 'Section B-One' })).toBeVisible()
    await expect(page.locator('.tree-node', { hasText: 'Section B-Two' })).toBeVisible()

    // The stale "select notebook" prompt must not appear anywhere
    await expect(page.locator('text=Select notebook to load sections')).toHaveCount(0)
  })

  test('clicking a non-active notebook switches active section to its first section', async ({ page }) => {
    await waitForApp(page, `#nb=${notebookA.id}&sec=${sectionA.id}&pg=${pageA.id}`)
    await ensureNavigationVisible(page)

    // Click notebook B row to select it (not just expand)
    await clickNavigationItem(page, rowFor(page, notebookB.title))

    // Notebook B is now active
    await expect(rowFor(page, notebookB.title)).toHaveClass(/active/)

    // Its first section should become active automatically
    await expect(rowFor(page, 'Section B-One')).toHaveClass(/active/)
  })

  test('switching back to a previously-active notebook retains its section state', async ({ page }) => {
    await waitForApp(page, `#nb=${notebookA.id}&sec=${sectionA.id}&pg=${pageA.id}`)
    await ensureNavigationVisible(page)

    // Switch to notebook B
    await clickNavigationItem(page, rowFor(page, notebookB.title))
    await expect(rowFor(page, notebookB.title)).toHaveClass(/active/)

    // Switch back to notebook A
    await clickNavigationItem(page, rowFor(page, notebookA.title))
    await expect(rowFor(page, notebookA.title)).toHaveClass(/active/)

    // Section A-One should still be visible in A's tree
    await expect(page.locator('.tree-node', { hasText: 'Section A-One' })).toBeVisible()
  })
})
