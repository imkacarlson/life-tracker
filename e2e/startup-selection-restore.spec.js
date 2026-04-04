import { test, expect } from './fixtures'
import { createNotebook, createPage, createSection, getSupabase } from './test-helpers'

const PAGE_TEXT = 'Saved selection startup regression marker'

test.describe('startup selection restore', () => {
  test('root load restores a saved page selection before persisting fallback state', async ({ page }) => {
    const { client, userId } = await getSupabase()
    const notebook = await createNotebook(client, userId, `Saved Selection Notebook ${Date.now()}`, 9999)
    const section = await createSection(client, userId, notebook.id, 'Saved Selection Section', 9999)
    const tracker = await createPage(
      client,
      userId,
      section.id,
      'Saved Selection Page',
      {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: PAGE_TEXT }] }],
      },
      9999,
    )

    await page.goto('/')
    await page.waitForSelector('.app:not(.app-auth)', { timeout: 15000 })
    await page.evaluate((selection) => {
      localStorage.setItem('life-tracker:lastSelection', JSON.stringify(selection))
    }, {
      notebookId: notebook.id,
      sectionId: section.id,
      pageId: tracker.id,
    })

    await page.goto('/')
    await page.waitForSelector('.app:not(.app-auth)', { timeout: 15000 })

    await expect(page.locator('.title-input')).toHaveValue('Saved Selection Page', { timeout: 10000 })
    await expect(page.locator('.ProseMirror')).toContainText(PAGE_TEXT, { timeout: 10000 })
  })
})
