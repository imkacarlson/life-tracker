/**
 * E2E tests for the mobile bottom toolbar.
 *
 * After the BlockNote-style port, the toolbar stays `position: fixed; bottom: 0`
 * and is lifted above the on-screen keyboard via `transform: translate(…)` written
 * imperatively by useMobileToolbarTransform.
 *
 * Playwright cannot open the real Android keyboard and does not simulate
 * `visualViewport` changes via `setViewportSize`. These tests therefore assert
 * behavioral outcomes that survive any positioning implementation:
 *   - the toolbar is visible on mobile
 *   - its buttons are tappable and route through to the editor
 *   - the editor-panel reserves space for the toolbar via --toolbar-height
 */

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
      attrs: { id: 'p-124-a' },
      content: [{ type: 'text', text: 'Keyboard toolbar test content' }],
    },
  ],
}

let seedIds = {}
const seedLabel = `KB-124-${Date.now()}`

test.beforeAll(async () => {
  const { client, userId } = await getSupabase()
  const notebook = await createNotebook(client, userId, `${seedLabel} Notebook`)
  const section = await createSection(client, userId, notebook.id, `${seedLabel} Section`, 0)
  const page = await createPage(client, userId, section.id, `${seedLabel} Page`, SEED_CONTENT, 0)
  seedIds = { notebook, section, page }
})

test.afterAll(async () => {
  const { client } = await getSupabase()
  await deleteNotebookById(client, seedIds.notebook?.id)
})

test('mobile toolbar is visible and pinned to the bottom of the viewport', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile-only test')

  const hash = `#nb=${seedIds.notebook.id}&sec=${seedIds.section.id}&pg=${seedIds.page.id}`
  await waitForApp(page, hash, { expectedText: 'Keyboard toolbar test content' })

  const toolbar = page.locator('.toolbar')
  await expect(toolbar).toBeVisible()

  const { bottomGap, position } = await page.evaluate(() => {
    const el = document.querySelector('.toolbar')
    const rect = el.getBoundingClientRect()
    return {
      bottomGap: window.innerHeight - rect.bottom,
      position: getComputedStyle(el).position,
    }
  })
  expect(position).toBe('fixed')
  expect(Math.abs(bottomGap)).toBeLessThanOrEqual(2) // within safe-area / rounding
})

test('bold button works from the mobile toolbar', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile-only test')

  const hash = `#nb=${seedIds.notebook.id}&sec=${seedIds.section.id}&pg=${seedIds.page.id}`
  await waitForApp(page, hash, { expectedText: 'Keyboard toolbar test content' })

  await page.locator('.ProseMirror').click()
  await page.keyboard.press('Control+A')

  const boldButton = page.getByRole('button', { name: 'Bold' })
  await expect(boldButton).toBeVisible()
  await boldButton.click()

  const hasBold = await page.evaluate(() => {
    const pm = document.querySelector('.ProseMirror')
    return pm ? pm.querySelector('strong') !== null : false
  })
  expect(hasBold).toBe(true)
})

test('indent and outdent buttons are visible in collapsed mobile toolbar without expanding', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile-only test')

  const hash = `#nb=${seedIds.notebook.id}&sec=${seedIds.section.id}&pg=${seedIds.page.id}`
  await waitForApp(page, hash, { expectedText: 'Keyboard toolbar test content' })

  // Do NOT click expand toggle — buttons must be reachable in collapsed state
  const indentBtn = page.getByTestId('toolbar-indent')
  const outdentBtn = page.getByTestId('toolbar-outdent')

  await expect(indentBtn).toBeVisible()
  await expect(outdentBtn).toBeVisible()
})

test('editor-panel reserves space so content is not hidden behind the toolbar', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile-only test')

  const hash = `#nb=${seedIds.notebook.id}&sec=${seedIds.section.id}&pg=${seedIds.page.id}`
  await waitForApp(page, hash, { expectedText: 'Keyboard toolbar test content' })

  const { paddingBottom, toolbarHeight } = await page.evaluate(() => {
    const panel = document.querySelector('.editor-panel')
    const toolbar = document.querySelector('.toolbar')
    return {
      paddingBottom: parseFloat(getComputedStyle(panel).paddingBottom) || 0,
      toolbarHeight: toolbar ? toolbar.getBoundingClientRect().height : 0,
    }
  })
  expect(toolbarHeight).toBeGreaterThan(0)
  expect(paddingBottom).toBeGreaterThanOrEqual(toolbarHeight - 1)
})
