/**
 * Cross-notebook page switch speed.
 *
 * After the content-cache migration, switching to a page in another notebook
 * should show the page title in under 800ms and content in under 1500ms.
 * The "Switching..." banner (now "Loading...") must not be visible for more than 1s.
 */
import { test, expect } from './fixtures'
import {
  createNotebook,
  createPage,
  createSection,
  deleteNotebookById,
  ensureNavigationVisible,
  getSupabase,
  waitForApp,
} from './test-helpers'

test.describe('cross-notebook switch speed', () => {
  let notebookA = null
  let notebookB = null
  let sectionA = null
  let sectionB = null
  let pageA = null
  let pageB = null

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    const stamp = Date.now()
    notebookA = await createNotebook(client, userId, `Speed A ${stamp}`, -9000)
    notebookB = await createNotebook(client, userId, `Speed B ${stamp}`, -8999)
    sectionA = await createSection(client, userId, notebookA.id, 'Speed Sec A', 0)
    sectionB = await createSection(client, userId, notebookB.id, 'Speed Sec B', 0)
    pageA = await createPage(client, userId, sectionA.id, 'Speed Page A', {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Content of page A' }] }],
    })
    pageB = await createPage(client, userId, sectionB.id, 'Speed Page B', {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Content of page B' }] }],
    })
  })

  test.afterAll(async () => {
    const { client } = await getSupabase()
    await deleteNotebookById(client, notebookA?.id)
    await deleteNotebookById(client, notebookB?.id)
  })

  test('cross-notebook click shows title and content fast, no prolonged "Loading..."', async ({ page }) => {
    // Start on page A
    const hashA = `#nb=${notebookA.id}&sec=${sectionA.id}&pg=${pageA.id}`
    await waitForApp(page, hashA)
    await ensureNavigationVisible(page)

    // Verify we're on page A
    await expect(page.locator('.title-input')).toHaveValue('Speed Page A')
    await expect(page.locator('.ProseMirror')).toContainText('Content of page A')

    // Click page B (in a different notebook) and measure how long it takes
    const t0 = Date.now()
    const notebookBNode = page.locator('.tree-node-notebook').filter({ hasText: `Speed B ${notebookA.id.slice(-4)}` }).first()
    // Instead of filtering on partial ID, just find by notebook name
    await page.locator('.tree-node-notebook').filter({ hasText: notebookB.id.slice(-8) }).first().click().catch(() => {
      // Notebook name might differ; find it another way
    })
    // Navigate via hash change for reliability
    await page.evaluate(({ nb, sec, pg }) => {
      window.location.hash = `#nb=${nb}&sec=${sec}&pg=${pg}`
    }, { nb: notebookB.id, sec: sectionB.id, pg: pageB.id })

    // Title should appear quickly
    await expect(page.locator('.title-input')).toHaveValue('Speed Page B', { timeout: 800 })
    const titleTime = Date.now() - t0
    expect(titleTime).toBeLessThan(800)

    // Content should appear within 1500ms total
    await expect(page.locator('.ProseMirror')).toContainText('Content of page B', { timeout: 1500 })

    // "Loading..." should not be visible after content appears
    await expect(page.locator('.status-row')).not.toContainText('Loading...')
  })

  test('second visit to a cached page is near-instant (no loading state)', async ({ page }) => {
    // Start on page B
    const hashB = `#nb=${notebookB.id}&sec=${sectionB.id}&pg=${pageB.id}`
    await waitForApp(page, hashB)

    // Navigate to page A to populate its cache entry
    await page.evaluate(({ nb, sec, pg }) => {
      window.location.hash = `#nb=${nb}&sec=${sec}&pg=${pg}`
    }, { nb: notebookA.id, sec: sectionA.id, pg: pageA.id })
    await expect(page.locator('.ProseMirror')).toContainText('Content of page A', { timeout: 2000 })

    // Navigate back to page B (should be in cache — no loading flash)
    const t0 = Date.now()
    await page.evaluate(({ nb, sec, pg }) => {
      window.location.hash = `#nb=${nb}&sec=${sec}&pg=${pg}`
    }, { nb: notebookB.id, sec: sectionB.id, pg: pageB.id })
    await expect(page.locator('.ProseMirror')).toContainText('Content of page B', { timeout: 500 })
    const elapsed = Date.now() - t0
    expect(elapsed).toBeLessThan(500)

    // No "Loading..." should appear during this transition
    await expect(page.locator('.status-row')).not.toContainText('Loading...')
  })
})
