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

test.describe('Issue #114 chevron toggle expand/collapse', () => {
  let notebook = null
  let sectionA = null
  let sectionB = null
  let pageA = null
  let pageB = null

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()

    notebook = await createNotebook(client, userId, `Issue114 Notebook ${Date.now()}`)
    sectionA = await createSection(client, userId, notebook.id, 'Section Alpha', 0)
    sectionB = await createSection(client, userId, notebook.id, 'Section Beta', 1)
    pageA = await createPage(client, userId, sectionA.id, 'Page Alpha', {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Alpha content' }] }],
    })
    pageB = await createPage(client, userId, sectionB.id, 'Page Beta', {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Beta content' }] }],
    })
  })

  test.afterAll(async () => {
    const { client } = await getSupabase()
    await deleteNotebookById(client, notebook?.id)
  })

  const navTo = (page, pgId) =>
    waitForApp(page, `#nb=${notebook.id}&sec=${sectionA.id}&pg=${pgId}`)

  /** Return the chevron span inside a tree-node button that contains the given label text. */
  const chevronFor = (page, label) =>
    page.locator('.tree-node', { hasText: label }).locator('.tree-chevron').first()

  /** Return the tree-node button row for a given label. */
  const rowFor = (page, label) =>
    page.locator('.tree-node', { hasText: label }).first()

  test('chevron click collapses an active notebook without deselecting it', async ({ page }) => {
    await navTo(page, pageA.id)
    await ensureNavigationVisible(page)

    // Notebook should be expanded (we navigated into it)
    const notebookRow = rowFor(page, notebook.title)
    await expect(notebookRow).toHaveAttribute('aria-expanded', 'true')

    // Section Alpha should be visible
    await expect(page.locator('.tree-node', { hasText: 'Section Alpha' })).toBeVisible()

    // Click the notebook chevron to collapse
    await clickNavigationItem(page, chevronFor(page, notebook.title))

    // Notebook row should now be collapsed
    await expect(notebookRow).toHaveAttribute('aria-expanded', 'false')

    // Sections should be hidden
    await expect(page.locator('.tree-node', { hasText: 'Section Alpha' })).toBeHidden()

    // The notebook row should still have the active class
    await expect(notebookRow).toHaveClass(/active/)
  })

  test('chevron click collapses an active section without deselecting it', async ({ page }) => {
    await navTo(page, pageA.id)
    await ensureNavigationVisible(page)

    const sectionRow = rowFor(page, 'Section Alpha')
    await expect(sectionRow).toHaveAttribute('aria-expanded', 'true')

    // Page should be visible
    await expect(page.locator('.tree-node', { hasText: 'Page Alpha' })).toBeVisible()

    // Click the section chevron to collapse
    await clickNavigationItem(page, chevronFor(page, 'Section Alpha'))

    // Section should be collapsed but still active
    await expect(sectionRow).toHaveAttribute('aria-expanded', 'false')
    await expect(sectionRow).toHaveClass(/active/)

    // Page should be hidden
    await expect(page.locator('.tree-node', { hasText: 'Page Alpha' })).toBeHidden()
  })

  test('multiple sections can be expanded simultaneously', async ({ page }) => {
    await navTo(page, pageA.id)
    await ensureNavigationVisible(page)

    // Section Alpha is expanded via navigation. Now click Section Beta row to select it.
    await clickNavigationItem(page, rowFor(page, 'Section Beta'))

    // Wait for Section Beta to expand
    await expect(rowFor(page, 'Section Beta')).toHaveAttribute('aria-expanded', 'true')

    // Section Alpha should still be expanded (independent state)
    await expect(rowFor(page, 'Section Alpha')).toHaveAttribute('aria-expanded', 'true')

    // Only the active section (Beta) shows its pages; Alpha's pages are not
    // loaded because the data layer fetches pages for the active section only.
    await expect(page.locator('.tree-node', { hasText: 'Page Beta' })).toBeVisible()
    await expect(page.locator('.tree-node', { hasText: 'Page Alpha' })).toBeHidden()
  })

  test('clicking row label selects and expands the item', async ({ page }) => {
    await navTo(page, pageA.id)
    await ensureNavigationVisible(page)

    // Collapse Section Alpha via chevron
    await clickNavigationItem(page, chevronFor(page, 'Section Alpha'))
    await expect(rowFor(page, 'Section Alpha')).toHaveAttribute('aria-expanded', 'false')

    // Click the section row label to re-select — should also expand
    await clickNavigationItem(page, rowFor(page, 'Section Alpha'))
    await expect(rowFor(page, 'Section Alpha')).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('.tree-node', { hasText: 'Page Alpha' })).toBeVisible()
  })
})
