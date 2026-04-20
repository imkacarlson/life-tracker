/**
 * Regression tests for the blank-on-load bug (session-keyed editor loading).
 *
 * Root cause: the old useLayoutEffect fired when activeTrackerId was set but
 * activeTracker was still null, hitting the equality short-circuit and
 * unlocking a blank editor. Fixed by useTrackerSession: the editor only mounts
 * after content is fully hydrated (status === 'ready').
 */
import { test, expect } from './fixtures'
import { createNotebook, createPage, createSection, getSupabase } from './test-helpers'

const PAGE_TEXT = 'FreshLoadRegressionMarker-' + Date.now()

test.describe('fresh page load always shows content', () => {
  let notebook, section, tracker

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    notebook = await createNotebook(client, userId, `Fresh Load Notebook ${Date.now()}`, -99999)
    section = await createSection(client, userId, notebook.id, 'Fresh Load Section', 0)
    tracker = await createPage(
      client,
      userId,
      section.id,
      'Fresh Load Page',
      {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: PAGE_TEXT }] }],
      },
      0,
    )
  })

  test('cold page load via hash URL shows editor content without navigating away', async ({
    page,
  }) => {
    const hash = `#nb=${notebook.id}&sec=${section.id}&pg=${tracker.id}`
    await page.goto(`/#${hash}`)
    await page.waitForSelector('.app:not(.app-auth)', { timeout: 15000 })

    // Title and content should both appear without any extra navigation.
    await expect(page.locator('.title-input')).toHaveValue('Fresh Load Page', { timeout: 10000 })
    await expect(page.locator('.ProseMirror')).toContainText(PAGE_TEXT, { timeout: 10000 })
  })

  test('cold root load then click page in sidebar shows editor content', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.app:not(.app-auth)', { timeout: 15000 })

    // Expand the notebook in the sidebar if needed.
    const notebookNode = page.locator('.tree-node-notebook', { hasText: notebook.title })
    await expect(notebookNode).toBeVisible({ timeout: 10000 })

    // Expand the notebook to reveal the section.
    await notebookNode.locator('.tree-node-chevron').click()
    const sectionNode = page.locator('.tree-node-section', { hasText: 'Fresh Load Section' })
    await expect(sectionNode).toBeVisible({ timeout: 5000 })

    // Click the page.
    const pageNode = page.locator('.tree-node-page', { hasText: 'Fresh Load Page' })
    await expect(pageNode).toBeVisible({ timeout: 5000 })
    await pageNode.click()

    await expect(page.locator('.title-input')).toHaveValue('Fresh Load Page', { timeout: 10000 })
    await expect(page.locator('.ProseMirror')).toContainText(PAGE_TEXT, { timeout: 10000 })
  })

  test('editor never shows blank then fills in (no flicker)', async ({ page }) => {
    const hash = `nb=${notebook.id}&sec=${section.id}&pg=${tracker.id}`
    await page.goto(`/#${hash}`)
    await page.waitForSelector('.app:not(.app-auth)', { timeout: 15000 })

    // Content should be present within 3 seconds of app ready — no 2-step blank→fill flicker.
    await expect(page.locator('.ProseMirror')).not.toBeEmpty({ timeout: 3000 })
    await expect(page.locator('.ProseMirror')).toContainText(PAGE_TEXT, { timeout: 10000 })
  })
})
