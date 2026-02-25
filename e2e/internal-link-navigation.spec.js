import { test, expect } from '@playwright/test'

/**
 * Internal Link Navigation Tests
 *
 * Prerequisites (seed data required):
 *   The test user must have at least two tracker pages where one page contains
 *   an internal link (a[href^="#pg="]) pointing to a block on another page.
 *
 * Selectors:
 *   - Internal links: a[href^="#pg="], a[href^="#sec="], a[href^="#nb="]
 *   - Highlighted block: .deep-link-target
 *   - Editor contenteditable: .ProseMirror[contenteditable="true"]
 */

test.describe('Internal link navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Start at root; auth state is restored from storageState
    await page.goto('/')
    // Wait for the authenticated app shell to be ready (not the login screen)
    await page.waitForSelector('.app:not(.app-auth)', { timeout: 10000 })
  })

  test('clicking an internal link navigates and highlights the target block', async ({ page }) => {
    // Find the first internal link in the page
    const internalLink = page.locator('a[href^="#pg="], a[href^="#sec="], a[href^="#nb="]').first()

    // Skip test gracefully if no seed data is present
    const linkCount = await internalLink.count()
    if (linkCount === 0) {
      test.skip(
        true,
        'No internal links found. Create seed data: two tracker pages where one links to the other.',
      )
    }

    // Capture the href before clicking
    const href = await internalLink.getAttribute('href')
    expect(href).toBeTruthy()

    // Click the internal link
    await internalLink.click()

    // Assert: URL hash changed to reflect the target
    await expect(page).toHaveURL(new RegExp(`${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))

    // Assert: a block with .deep-link-target class is present and visible
    const highlightedBlock = page.locator('.deep-link-target').first()
    await expect(highlightedBlock).toBeVisible({ timeout: 5000 })

    // Assert: the highlighted block is within viewport (scrolled to)
    await expect(highlightedBlock).toBeInViewport()
  })

  test('mobile: tapping an internal link does not open the keyboard', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'Mobile-only test')

    const internalLink = page.locator('a[href^="#pg="], a[href^="#sec="], a[href^="#nb="]').first()

    const linkCount = await internalLink.count()
    if (linkCount === 0) {
      test.skip(
        true,
        'No internal links found. Create seed data: two tracker pages where one links to the other.',
      )
    }

    const href = await internalLink.getAttribute('href')

    // Tap the internal link
    await internalLink.tap()

    // Assert: URL hash changed
    await expect(page).toHaveURL(new RegExp(`${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))

    // Assert: highlighted block is visible
    const highlightedBlock = page.locator('.deep-link-target').first()
    await expect(highlightedBlock).toBeVisible({ timeout: 5000 })

    // Assert: no contenteditable is focused — keyboard did NOT open
    const focusedIsEditor = await page.evaluate(() => {
      const el = document.activeElement
      return el?.matches?.('.ProseMirror[contenteditable="true"]') ?? false
    })
    expect(focusedIsEditor).toBe(false)

    // Assert: intentional tap on highlighted block DOES focus the editor
    await highlightedBlock.tap()

    // Wait a tick for focus to settle
    await page.waitForTimeout(200)

    const focusedAfterTap = await page.evaluate(() => {
      const el = document.activeElement
      return (
        el?.matches?.('.ProseMirror[contenteditable="true"]') ||
        Boolean(el?.closest?.('.ProseMirror[contenteditable="true"]'))
      )
    })
    expect(focusedAfterTap).toBe(true)
  })
})
