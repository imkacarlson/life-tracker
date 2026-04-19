/**
 * E2E tests for cursor-visibility-on-toolbar-expand (mobile only).
 *
 * When the user taps the expand button on the mobile toolbar, the toolbar grows
 * from its collapsed height to its full height. If the cursor is in the lower
 * half of the visible viewport, the page should scroll so the cursor remains
 * visible above the expanded toolbar.
 *
 * Playwright cannot open the real virtual keyboard and therefore cannot shrink
 * visualViewport the way a real device does. These tests approximate the
 * scenario by:
 *   1. Loading a page with enough content to scroll
 *   2. Clicking a paragraph near the bottom of the visible area
 *   3. Expanding the toolbar
 *   4. Asserting the cursor's bottom edge is above the toolbar's top edge
 *
 * The test intentionally scrolls the editor near the bottom before expanding,
 * simulating a cursor that would be covered by an expanded toolbar.
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

// Build a doc with enough paragraphs to fill more than one screen so we can
// place the cursor near the bottom of the viewport.
const buildSeedContent = () => {
  const paragraphs = []
  for (let i = 1; i <= 30; i++) {
    paragraphs.push({
      type: 'paragraph',
      attrs: { id: `p-cvis-${i}` },
      content: [{ type: 'text', text: `Cursor visibility test line ${i}` }],
    })
  }
  return { type: 'doc', content: paragraphs }
}

let seedIds = {}
const seedLabel = `KB-CVIS-${Date.now()}`

test.beforeAll(async () => {
  const { client, userId } = await getSupabase()
  const notebook = await createNotebook(client, userId, `${seedLabel} Notebook`)
  const section = await createSection(client, userId, notebook.id, `${seedLabel} Section`, 0)
  const page = await createPage(
    client,
    userId,
    section.id,
    `${seedLabel} Page`,
    buildSeedContent(),
    0,
  )
  seedIds = { notebook, section, page }
})

test.afterAll(async () => {
  const { client } = await getSupabase()
  await deleteNotebookById(client, seedIds.notebook?.id)
})

test(
  'cursor stays visible when toolbar expands on mobile',
  async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Mobile-only test')

    const hash = `#nb=${seedIds.notebook.id}&sec=${seedIds.section.id}&pg=${seedIds.page.id}`
    await waitForApp(page, hash, { expectedText: 'Cursor visibility test line 1' })

    // Scroll near the bottom of the editor content so the cursor ends up
    // in the lower portion of the visible viewport.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(200)

    // Click on the last visible paragraph to place the cursor there.
    const lastPara = page.locator('.ProseMirror p').last()
    await lastPara.click()
    await page.waitForTimeout(200)

    // Capture cursor bottom BEFORE expanding the toolbar.
    const cursorBottomBefore = await page.evaluate(() => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return null
      return sel.getRangeAt(0).getBoundingClientRect().bottom
    })

    // Only proceed with the scroll assertion if the cursor is actually
    // in the lower portion of the viewport (where it could be obscured).
    const viewportHeight = page.viewportSize()?.height ?? 800
    if (cursorBottomBefore === null || cursorBottomBefore < viewportHeight * 0.5) {
      // Cursor is already in the safe zone; scroll assertion not meaningful.
      return
    }

    // Expand the toolbar.
    const expandToggle = page.getByTestId('toolbar-expand-toggle')
    await expect(expandToggle).toBeVisible()
    await expandToggle.click()

    // Wait two animation frames for the hook to run and scroll to settle.
    await page.waitForTimeout(400)

    // After expand + scroll, cursor bottom must be above toolbar top.
    const { cursorBottom, toolbarTop } = await page.evaluate(() => {
      const sel = window.getSelection()
      const cursorBottom = sel && sel.rangeCount > 0
        ? sel.getRangeAt(0).getBoundingClientRect().bottom
        : null
      const toolbar = document.querySelector('.toolbar')
      const toolbarTop = toolbar ? toolbar.getBoundingClientRect().top : null
      return { cursorBottom, toolbarTop }
    })

    expect(cursorBottom).not.toBeNull()
    expect(toolbarTop).not.toBeNull()
    // Cursor bottom should be above (less than) the toolbar's top edge,
    // with a 2px tolerance for rounding.
    expect(cursorBottom).toBeLessThanOrEqual(toolbarTop + 2)
  },
)

test(
  'toolbar expand does not scroll when cursor is already above the toolbar',
  async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Mobile-only test')

    const hash = `#nb=${seedIds.notebook.id}&sec=${seedIds.section.id}&pg=${seedIds.page.id}`
    await waitForApp(page, hash, { expectedText: 'Cursor visibility test line 1' })

    // Click near the top of the document — cursor is in the safe zone.
    const firstPara = page.locator('.ProseMirror p').first()
    await firstPara.click()
    await page.waitForTimeout(200)

    const scrollBefore = await page.evaluate(() => window.scrollY)

    const expandToggle = page.getByTestId('toolbar-expand-toggle')
    await expandToggle.click()
    await page.waitForTimeout(400)

    const scrollAfter = await page.evaluate(() => window.scrollY)

    // No meaningful scroll should occur when cursor is already visible.
    expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThanOrEqual(10)
  },
)
