import { test, expect } from '@playwright/test'

/**
 * Internal Link Navigation Tests
 *
 * Seed data assumption: the test user account has:
 *   - A page called "Test Scratchpad" containing an internal link pointing to "Test Section"
 *   - A page called "Test Section" with content including the target block
 */

test.describe('Internal link navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.app:not(.app-auth)', { timeout: 10000 })
  })

  test('deep link highlights target block, clicking elsewhere unhighlights', async ({ page }) => {
    // 1. Navigate to Test Scratchpad via sidebar and read the internal link href
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

    // 3. Trigger the deep link by setting the hash — the page content is already
    //    in the DOM so scrollToBlock will find the block immediately
    await page.evaluate((h) => { window.location.hash = h }, href)

    // 4. The app highlights the target block via a <style> tag that targets the
    //    block by its id attribute. Wait for the style element to contain the block ID.
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
