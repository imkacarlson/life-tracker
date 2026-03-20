import { test, expect } from './fixtures'
import { getSupabase, createPage, findFirstSection, waitForApp } from './test-helpers'

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

test.describe('Issue #67 recorded Ctrl+A cascade flow', () => {
  let sourcePage = null
  let targetPage = null

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    const sectionId = await findFirstSection(client, userId)
    sourcePage = await createPage(client, userId, sectionId, 'Sunday Tasks', SOURCE_CONTENT)
    targetPage = await createPage(client, userId, sectionId, 'Test Scratchpad', TARGET_CONTENT)
  })

  test('Sunday Tasks list selection expands on second Ctrl+A before copy', async ({ page }) => {
    // Navigate to source page
    await waitForApp(page, `/#pg=${sourcePage.id}`)
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

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
    const targetPageLink = page.locator('.sidebar-title', { hasText: 'Test Scratchpad' }).first()
    await targetPageLink.click()
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })
    await page.getByText('Go for a run').first().click()
  })
})
