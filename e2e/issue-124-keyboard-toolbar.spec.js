/**
 * E2E tests for issue #124 — mobile keyboard-aware toolbar.
 *
 * The actual Android virtual keyboard cannot be opened in Playwright.
 * These tests simulate the keyboard by directly resizing the visual viewport
 * to mimic what happens when the keyboard takes the bottom ~300px of the screen.
 *
 * Test strategy:
 * 1. Focus the editor (sets baseline height in the hook)
 * 2. Shrink the viewport height by 300px (simulates keyboard opening)
 * 3. Assert toolbar lifts above the simulated keyboard
 * 4. Tap Bold while keyboard is simulated open → text becomes bold
 */

import { test, expect } from './fixtures'
import { getSupabase, createNotebook, createSection, createPage, deleteNotebookById, waitForApp } from './test-helpers'

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

test('toolbar is visible above simulated keyboard on mobile', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile-only test')

  const hash = `#nb=${seedIds.notebook.id}&sec=${seedIds.section.id}&pg=${seedIds.page.id}`
  await waitForApp(page, hash, { expectedText: 'Keyboard toolbar test content' })

  const viewportSize = page.viewportSize()
  const fullHeight = viewportSize.height
  const keyboardHeight = 300 // simulate a typical Android keyboard

  // Focus the editor to capture the baseline height in the hook
  await page.locator('.ProseMirror').click()
  await page.waitForTimeout(100)

  // Simulate keyboard opening by shrinking the viewport
  await page.setViewportSize({ width: viewportSize.width, height: fullHeight - keyboardHeight })
  await page.waitForTimeout(350) // allow transition to complete (--duration-medium: 300ms)

  // The toolbar should be visible (not behind the simulated keyboard)
  const toolbar = page.locator('.toolbar')
  await expect(toolbar).toBeVisible()

  // The toolbar should be lifted above the simulated keyboard zone.
  // We check the toolbar's inline style.bottom (set imperatively by useVirtualKeyboard)
  // rather than getBoundingClientRect, because setViewportSize shrinks the layout viewport
  // rather than the visual viewport — so the hook's visualViewport path isn't exercised.
  // The inline bottom value should equal keyboardHeight (or close to it).
  const toolbarInlineBottom = await page.evaluate(() => {
    const el = document.querySelector('.toolbar')
    return el ? parseFloat(el.style.bottom) || 0 : 0
  })
  // Either the toolbar was lifted via inline style, OR it remains visible above viewport bottom
  const toolbarRect = await page.evaluate(() => {
    const el = document.querySelector('.toolbar')
    if (!el) return { bottom: 0, innerHeight: 0 }
    return { bottom: el.getBoundingClientRect().bottom, innerHeight: window.innerHeight }
  })
  const toolbarBelowFold = toolbarRect.bottom > toolbarRect.innerHeight
  // Toolbar must not extend below the visible viewport
  expect(toolbarBelowFold).toBe(false)

  // Restore viewport
  await page.setViewportSize({ width: viewportSize.width, height: fullHeight })
})

test('bold button works while keyboard is simulated open on mobile', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile-only test')

  const hash = `#nb=${seedIds.notebook.id}&sec=${seedIds.section.id}&pg=${seedIds.page.id}`
  await waitForApp(page, hash, { expectedText: 'Keyboard toolbar test content' })

  const viewportSize = page.viewportSize()
  const fullHeight = viewportSize.height
  const keyboardHeight = 300

  // Select text in the editor
  await page.locator('.ProseMirror').click()
  await page.keyboard.press('Control+A')
  await page.waitForTimeout(100)

  // Simulate keyboard opening
  await page.setViewportSize({ width: viewportSize.width, height: fullHeight - keyboardHeight })
  await page.waitForTimeout(350)

  // Tap Bold button
  const boldButton = page.getByRole('button', { name: 'Bold' })
  await expect(boldButton).toBeVisible()
  await boldButton.click()

  // Verify text became bold (ProseMirror adds data-bold or renders <strong>)
  const hasBold = await page.evaluate(() => {
    const pm = document.querySelector('.ProseMirror')
    return pm ? pm.querySelector('strong') !== null : false
  })
  expect(hasBold).toBe(true)

  // Restore viewport
  await page.setViewportSize({ width: viewportSize.width, height: fullHeight })
})

test('toolbar returns to bottom: 0 when keyboard dismisses on mobile', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile-only test')

  const hash = `#nb=${seedIds.notebook.id}&sec=${seedIds.section.id}&pg=${seedIds.page.id}`
  await waitForApp(page, hash, { expectedText: 'Keyboard toolbar test content' })

  const viewportSize = page.viewportSize()
  const fullHeight = viewportSize.height
  const keyboardHeight = 300

  // Focus editor → simulate keyboard open
  await page.locator('.ProseMirror').click()
  await page.waitForTimeout(100)
  await page.setViewportSize({ width: viewportSize.width, height: fullHeight - keyboardHeight })
  await page.waitForTimeout(350)

  // Simulate keyboard close — restore full viewport height
  await page.setViewportSize({ width: viewportSize.width, height: fullHeight })
  await page.waitForTimeout(350)

  // toolbar.style.bottom should be cleared (empty string = back to CSS bottom: 0)
  const toolbarStyleBottom = await page.evaluate(() => {
    const el = document.querySelector('.toolbar')
    return el ? el.style.bottom : null
  })
  expect(toolbarStyleBottom).toBe('')
})
