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

test.describe('navigation target flow', () => {
  let notebookA = null
  let notebookB = null
  let sectionA1 = null
  let sectionA2 = null
  let sectionB = null
  let pageA1 = null
  let pageA2 = null
  let pageB = null

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    const stamp = Date.now()
    notebookA = await createNotebook(client, userId, `Nav Flow A ${stamp}`, -9100)
    notebookB = await createNotebook(client, userId, `Nav Flow B ${stamp}`, -9099)
    sectionA1 = await createSection(client, userId, notebookA.id, 'Nav Flow A One', 0)
    sectionA2 = await createSection(client, userId, notebookA.id, 'Nav Flow A Two', 1)
    sectionB = await createSection(client, userId, notebookB.id, 'Nav Flow B One', 0)
    pageA1 = await createPage(client, userId, sectionA1.id, 'Nav Flow A Page One', {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A one content' }] }],
    })
    pageA2 = await createPage(client, userId, sectionA2.id, 'Nav Flow A Page Two', {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A two content' }] }],
    })
    pageB = await createPage(client, userId, sectionB.id, 'Nav Flow B Page', {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B page content' }] }],
    })
  })

  test.afterAll(async () => {
    const { client } = await getSupabase()
    await deleteNotebookById(client, notebookA?.id)
    await deleteNotebookById(client, notebookB?.id)
  })

  test('same-notebook section click loads that section page as one target', async ({ page }) => {
    await waitForApp(page, `#nb=${notebookA.id}&sec=${sectionA1.id}&pg=${pageA1.id}`)
    await ensureNavigationVisible(page)

    await clickNavigationItem(page, page.locator('.tree-node-section', { hasText: sectionA2.title }).first())

    await expect(page.locator('.tree-node-section', { hasText: sectionA2.title })).toHaveClass(/active/)
    await expect(page.locator('.title-input')).toHaveValue(pageA2.title, { timeout: 10000 })
    await expect(page.locator('.ProseMirror')).toContainText('A two content', { timeout: 10000 })
    await expect(page.locator('.status-row')).not.toContainText('No tracker selected')
  })

  test('cross-notebook page click applies notebook, section, and page together', async ({ page }) => {
    await waitForApp(page, `#nb=${notebookA.id}&sec=${sectionA1.id}&pg=${pageA1.id}`)
    await ensureNavigationVisible(page)

    await clickNavigationItem(page, page.locator('.tree-node-notebook', { hasText: notebookB.title }).locator('.tree-chevron').first())
    await clickNavigationItem(page, page.locator('.tree-node-section', { hasText: sectionB.title }).locator('.tree-chevron').first())
    await clickNavigationItem(page, page.locator('.tree-node-page', { hasText: pageB.title }).first())

    await expect(page.locator('.tree-node-notebook', { hasText: notebookB.title })).toHaveClass(/active/)
    await expect(page.locator('.tree-node-section', { hasText: sectionB.title })).toHaveClass(/active/)
    await expect(page.locator('.title-input')).toHaveValue(pageB.title, { timeout: 10000 })
    await expect(page.locator('.ProseMirror')).toContainText('B page content', { timeout: 10000 })
    await expect(page).toHaveURL(new RegExp(`#pg=${pageB.id}`))
  })
})
