import { test, expect } from './fixtures'
import {
  getSupabase,
  createNotebook,
  createSection,
  createPage,
  deleteNotebookById,
  waitForApp,
} from './test-helpers'

const SEED_CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id: 'more-menu-position-line' },
      content: [{ type: 'text', text: 'More menu positioning test' }],
    },
  ],
}

test.describe('More toolbar menu positioning', () => {
  let notebookId = null
  let testPage = null

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    const notebook = await createNotebook(client, userId, `More Menu Notebook ${Date.now()}`)
    notebookId = notebook.id
    const section = await createSection(client, userId, notebook.id, 'More Menu Section')
    testPage = await createPage(client, userId, section.id, 'More Menu Page', SEED_CONTENT)
  })

  test.afterAll(async () => {
    const { client } = await getSupabase()
    await deleteNotebookById(client, notebookId)
  })

  test('wrapped More menu stays within the toolbar instead of opening behind navigation @desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1220, height: 900 })
    await waitForApp(page, `/#pg=${testPage.id}`, { expectedText: 'More menu positioning test' })

    const toolbar = page.locator('.toolbar')
    const moreButton = page.getByRole('button', { name: 'More actions' })
    const toolbarRect = await toolbar.boundingBox()
    const buttonRect = await moreButton.boundingBox()

    expect(toolbarRect).not.toBeNull()
    expect(buttonRect).not.toBeNull()
    expect(buttonRect.x - toolbarRect.x).toBeLessThan(60)

    await moreButton.click()
    const menu = page.locator('.more-menu')
    await expect(menu).toBeVisible()

    const menuRect = await menu.boundingBox()
    expect(menuRect).not.toBeNull()
    expect(menuRect.x).toBeGreaterThanOrEqual(toolbarRect.x - 1)
    expect(menuRect.x + menuRect.width).toBeLessThanOrEqual(
      toolbarRect.x + toolbarRect.width + 1,
    )
  })
})
