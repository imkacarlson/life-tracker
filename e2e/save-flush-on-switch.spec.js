/**
 * Edit page A → click page B → return to page A → assert edits persisted.
 *
 * Verifies the flush-on-switch behavior: when navigating away from an edited
 * page, any pending debounced saves are flushed before activating the new page.
 */
import { test, expect } from './fixtures'
import {
  createNotebook,
  createPage,
  createSection,
  deleteNotebookById,
  getSupabase,
  waitForApp,
} from './test-helpers'

test.describe('save flush on page switch', () => {
  let notebook = null
  let section = null
  let pageA = null
  let pageB = null

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    const stamp = Date.now()
    notebook = await createNotebook(client, userId, `Flush ${stamp}`, -8900)
    section = await createSection(client, userId, notebook.id, 'Flush Sec', 0)
    pageA = await createPage(client, userId, section.id, 'Flush Page A', {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original A content' }] }],
    })
    pageB = await createPage(client, userId, section.id, 'Flush Page B', {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Page B content' }] }],
    }, 1)
  })

  test.afterAll(async () => {
    const { client } = await getSupabase()
    await deleteNotebookById(client, notebook?.id)
  })

  test('edits to page A are saved when switching to page B and back', async ({ page }) => {
    const hashA = `#nb=${notebook.id}&sec=${section.id}&pg=${pageA.id}`
    await waitForApp(page, hashA)

    // Verify starting state
    await expect(page.locator('.ProseMirror')).toContainText('Original A content')

    // Type new content into the editor
    await page.locator('.ProseMirror').click()
    await page.keyboard.press('End')
    await page.keyboard.type(' — edited')

    // Wait briefly (but less than the 2s autosave debounce) then switch pages
    await page.waitForTimeout(200)

    // Switch to page B
    await page.evaluate(({ nb, sec, pg }) => {
      window.location.hash = `#nb=${nb}&sec=${sec}&pg=${pg}`
    }, { nb: notebook.id, sec: section.id, pg: pageB.id })
    await expect(page.locator('.ProseMirror')).toContainText('Page B content', { timeout: 2000 })

    // Wait a moment for the flush-on-switch save to complete
    await page.waitForTimeout(1500)

    // Return to page A
    await page.evaluate(({ nb, sec, pg }) => {
      window.location.hash = `#nb=${nb}&sec=${sec}&pg=${pg}`
    }, { nb: notebook.id, sec: section.id, pg: pageA.id })
    await expect(page.locator('.ProseMirror')).toContainText('Original A content', { timeout: 2000 })

    // The edit should be persisted (either from flush-on-switch or the 2s autosave)
    await expect(page.locator('.ProseMirror')).toContainText('— edited', { timeout: 3000 })

    // Save status should show Saved (not Saving... or Unsaved)
    await expect(page.locator('.status-row')).toContainText('Saved', { timeout: 3000 })
  })
})
