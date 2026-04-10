import { test, expect } from './fixtures'
import { getSupabase, createNotebook, createSection, createPage, deleteNotebookById, waitForApp } from './test-helpers'

// Block ID that will be used as the deep-link target in Page B
const TARGET_BLOCK_ID = 'e2e-target-block-nav'

test.describe('Internal link navigation', () => {
  let notebookId = null
  let pageA = null // "Test Scratchpad" with internal link
  let pageB = null // "Test Section" with target block

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    const nb = await createNotebook(client, userId, `InternalLink Notebook ${Date.now()}`)
    notebookId = nb.id
    const sec = await createSection(client, userId, nb.id, 'InternalLink Section')
    const sectionId = sec.id

    // Create Page B first so we have its ID for the internal link
    pageB = await createPage(client, userId, sectionId, 'Test Section', {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2, id: 'h-nav-top' },
          content: [{ type: 'text', text: 'Running Stuff' }],
        },
        {
          type: 'paragraph',
          attrs: { id: 'p-nav-filler' },
          content: [{ type: 'text', text: 'Some filler content above the target.' }],
        },
        {
          type: 'paragraph',
          attrs: { id: TARGET_BLOCK_ID },
          content: [{ type: 'text', text: 'This is the deep link target paragraph.' }],
        },
        {
          type: 'paragraph',
          attrs: { id: 'p-nav-below' },
          content: [{ type: 'text', text: 'Content below the target block.' }],
        },
      ],
    })

    // Create Page A with an internal link pointing to Page B's target block
    const linkHref = `#pg=${pageB.id}&block=${TARGET_BLOCK_ID}`
    pageA = await createPage(client, userId, sectionId, 'Test Scratchpad', {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: 'p-nav-link' },
          content: [
            { type: 'text', text: 'Click here to go to ' },
            {
              type: 'text',
              marks: [
                {
                  type: 'link',
                  attrs: { href: linkHref, target: '_self', class: null },
                },
              ],
              text: 'the target block',
            },
          ],
        },
      ],
    })
  })

  test.afterAll(async () => {
    const { client } = await getSupabase()
    await deleteNotebookById(client, notebookId)
  })

  test.beforeEach(async ({ page }) => {
    // Navigate to Page A so the correct notebook/section is active
    await waitForApp(page, `/#pg=${pageA.id}`, { expectedText: 'Click here to go to' })
  })

  test('deep link highlights target block, clicking elsewhere unhighlights', async ({ page }) => {
    // 1. Navigate to Page A (Test Scratchpad) and read the internal link href
    await page.locator('.sidebar-title', { hasText: 'Test Scratchpad' }).click()
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 5000 })
    const internalLink = page.locator('.ProseMirror a[href*="pg="]').first()
    await expect(internalLink).toBeVisible({ timeout: 10000 })
    const href = await internalLink.getAttribute('href')

    // Extract blockId from the href for later assertions
    const blockId = new URL('http://x/' + href.replace('#', '?')).searchParams.get('block')
    expect(blockId).toBeTruthy()

    // 2. Navigate to the target page ("Test Section") via sidebar so content is loaded
    await page.locator('.sidebar-title', { hasText: 'Test Section' }).click()
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 5000 })

    // 3. Trigger the deep link by setting the hash
    await page.evaluate((h) => { window.location.hash = h }, href)

    // 4. The app highlights the target block via a <style> tag
    const styleLocator = page.locator('#deep-link-target-style')
    await expect(async () => {
      const content = await styleLocator.textContent()
      expect(content).toContain(blockId)
    }).toPass({ timeout: 10000 })

    // 5. Target block element should be in the viewport (scrolled to)
    const targetBlock = page.locator(`[id="${blockId}"]`)
    await expect(targetBlock).toBeVisible({ timeout: 5000 })
    await expect(targetBlock).toBeInViewport()

    // 6. Click a different paragraph in the editor to dismiss the highlight
    const otherParagraph = page.locator(`.ProseMirror p:not([id="${blockId}"])`).first()
    await otherParagraph.click()

    // 7. Highlight style should be cleared
    await expect(async () => {
      const content = await styleLocator.textContent()
      expect(content?.trim() || '').toBe('')
    }).toPass({ timeout: 5000 })
  })
})
