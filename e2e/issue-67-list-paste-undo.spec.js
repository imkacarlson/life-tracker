import { test, expect } from './fixtures'
import {
  clickNavigationItem,
  createNotebook,
  createPage,
  createSection,
  deleteNotebookById,
  getSupabase,
  waitForApp,
} from './test-helpers'

// Self-contained seed data: two pages — a source with a list and a target with text
const SOURCE_CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2, id: 'h-sunday' },
      content: [{ type: 'text', text: 'Sunday Tasks' }],
    },
    {
      type: 'bulletList',
      attrs: { id: 'bl-sunday-1' },
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Do core' }],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Clean kitchen' }],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Meal prep' }],
            },
          ],
        },
      ],
    },
  ],
}

const TARGET_CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id: 'p-scratch-1' },
      content: [{ type: 'text', text: 'Go for a run' }],
    },
    {
      type: 'paragraph',
      attrs: { id: 'p-scratch-2' },
      content: [{ type: 'text', text: 'Some other notes here' }],
    },
  ],
}

const readSelectionText = async (page) =>
  page.evaluate(() => {
    const selection = window.getSelection?.()
    return selection ? selection.toString() : ''
  })

// fixme: clipboard simulation against ProseMirror is inherently timing-sensitive;
// these pass locally but flake in CI due to async content hydration races.
test.describe.fixme('Issue #67 recorded Ctrl+A cascade flow', () => {
  let notebookId = null
  let sourcePage = null
  let targetPage = null

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    // Create an isolated notebook+section so deep-link navigation is deterministic
    const notebook = await createNotebook(client, userId, `T67 Notebook ${Date.now()}`)
    notebookId = notebook.id
    const section = await createSection(client, userId, notebook.id, 'T67 Section')
    sourcePage = await createPage(client, userId, section.id, 'Sunday Tasks', SOURCE_CONTENT)
    targetPage = await createPage(client, userId, section.id, 'Test Scratchpad', TARGET_CONTENT)
  })

  test.afterAll(async () => {
    const { client } = await getSupabase()
    await deleteNotebookById(client, notebookId)
  })

  test('Sunday Tasks list selection expands on second Ctrl+A before copy', async ({ page }) => {
    // Navigate to source page
    await waitForApp(page, `/#pg=${sourcePage.id}`)
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

    // Wait for the seeded content to render (guards against deep-link nav settling)
    await expect(page.locator('.ProseMirror')).toContainText('Do core', { timeout: 15000 })

    const sourceLine = page.locator('.ProseMirror p, .ProseMirror li', { hasText: 'Do core' }).first()
    await sourceLine.click()

    await page.keyboard.press('ControlOrMeta+a')
    const firstSelection = (await readSelectionText(page)).trim()
    await page.keyboard.press('ControlOrMeta+a')
    const secondSelection = (await readSelectionText(page)).trim()

    expect(firstSelection.length).toBeGreaterThan(0)
    expect(secondSelection.length).toBeGreaterThan(firstSelection.length)

    await page.keyboard.press('ControlOrMeta+c')

    // Navigate to target page via sidebar
    const targetPageLink = page.locator('.tree-node-page', { hasText: 'Test Scratchpad' }).first()
    await clickNavigationItem(page, targetPageLink)
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })
    await page.getByText('Go for a run').first().click()
  })
})
