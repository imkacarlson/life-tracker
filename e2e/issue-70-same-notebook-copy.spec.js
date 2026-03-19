import { test, expect } from './fixtures'

/**
 * Issue #70 — Copy section to same notebook with auto-suffixed titles
 *
 * Seed data assumption: the test user account has:
 *   - A section called "Test Section" with at least one page
 *   - A page called "Test Scratchpad" containing an internal link (href with pg= and block=)
 */

test.describe('Issue #70 same-notebook section copy', () => {
  const waitForApp = async (page) => {
    await page.goto('/')
    await page.waitForSelector('.app:not(.app-auth)', { timeout: 15000 })
  }

  const findTestSection = async (page) => {
    const tab = page.locator('.section-tab', { hasText: 'Test Section' }).first()
    let seedVisible = true
    try {
      await tab.waitFor({ state: 'visible', timeout: 5000 })
    } catch {
      seedVisible = false
    }
    return { tab, seedVisible }
  }

  test('copy section to same notebook creates suffixed duplicate', async ({ page }) => {
    await waitForApp(page)
    const { tab, seedVisible } = await findTestSection(page)
    test.skip(!seedVisible, 'Seed data missing — Test Section required')

    // Right-click the section tab to open context menu
    await tab.click({ button: 'right' })
    const copyBtn = page.getByRole('button', { name: 'Copy to…' })
    await expect(copyBtn).toBeVisible({ timeout: 3000 })
    await copyBtn.click()

    // Modal should show — select the current notebook (it should now be in the list)
    const modal = page.locator('.copy-move-modal')
    await expect(modal).toBeVisible({ timeout: 3000 })
    const select = modal.locator('select')

    // Find the current notebook option — it's the one whose sections include "Test Section"
    // Just pick the first non-empty option (the notebook list includes the active one now)
    const options = select.locator('option:not([value=""])')
    const optionCount = await options.count()
    expect(optionCount).toBeGreaterThan(0)
    const firstOptionValue = await options.first().getAttribute('value')
    await select.selectOption(firstOptionValue)

    // Click Copy
    await modal.getByRole('button', { name: 'Copy' }).click()
    await expect(modal).not.toBeVisible({ timeout: 3000 })

    // The copied section should appear with a suffixed name
    const copiedTab = page.locator('.section-tab', { hasText: 'Test Section (1)' })
    await expect(copiedTab).toBeVisible({ timeout: 5000 })

    // Clean up: delete the copied section via its × button
    page.once('dialog', (dialog) => dialog.accept())
    await copiedTab.locator('.tab-delete').click()
    await expect(copiedTab).not.toBeVisible({ timeout: 5000 })
  })

  test('copy section remaps internal links to copied pages', async ({ page }) => {
    await waitForApp(page)
    const { tab, seedVisible } = await findTestSection(page)
    test.skip(!seedVisible, 'Seed data missing — Test Section required')

    // First, find an internal link in Test Scratchpad to know what to look for
    await tab.click()
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })
    const scratchpadPage = page.locator('.sidebar-title', { hasText: 'Test Scratchpad' })
    let hasScratchpad = true
    try {
      await scratchpadPage.waitFor({ state: 'visible', timeout: 3000 })
    } catch {
      hasScratchpad = false
    }
    test.skip(!hasScratchpad, 'Seed data missing — Test Scratchpad page with internal link required')

    await scratchpadPage.click()
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

    // Read the original internal link href
    const originalLink = page.locator('.ProseMirror a[href*="pg="]').first()
    await expect(originalLink).toBeVisible({ timeout: 5000 })
    const originalHref = await originalLink.getAttribute('href')
    const originalParams = new URLSearchParams(originalHref.slice(1))
    const originalPageId = originalParams.get('pg')
    const originalSectionId = originalParams.get('sec')
    expect(originalPageId).toBeTruthy()

    // Copy the section to the same notebook
    await tab.click({ button: 'right' })
    await page.getByRole('button', { name: 'Copy to…' }).click()

    const modal = page.locator('.copy-move-modal')
    await expect(modal).toBeVisible({ timeout: 3000 })
    const select = modal.locator('select')
    const options = select.locator('option:not([value=""])')
    const firstOptionValue = await options.first().getAttribute('value')
    await select.selectOption(firstOptionValue)
    await modal.getByRole('button', { name: 'Copy' }).click()
    await expect(modal).not.toBeVisible({ timeout: 3000 })

    // Navigate to the copied section (tab only appears after copy is fully complete)
    const copiedTab = page.locator('.section-tab', { hasText: 'Test Section (1)' })
    await expect(copiedTab).toBeVisible({ timeout: 10000 })
    await copiedTab.click()
    const copiedScratchpad = page.locator('.sidebar-title', { hasText: 'Test Scratchpad' })
    await expect(copiedScratchpad).toBeVisible({ timeout: 10000 })
    await copiedScratchpad.click()
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

    const copiedLink = page.locator('.ProseMirror a[href*="pg="]').first()
    await expect(copiedLink).toBeVisible({ timeout: 5000 })
    const copiedHref = await copiedLink.getAttribute('href')
    const copiedParams = new URLSearchParams(copiedHref.slice(1))
    const copiedPageId = copiedParams.get('pg')
    const copiedSectionId = copiedParams.get('sec')

    // The link should point to a DIFFERENT page and section than the original
    expect(copiedPageId).toBeTruthy()
    expect(copiedPageId).not.toBe(originalPageId)
    if (originalSectionId) {
      expect(copiedSectionId).toBeTruthy()
      expect(copiedSectionId).not.toBe(originalSectionId)
    }

    // Clean up: delete the copied section via its × button
    page.once('dialog', (dialog) => dialog.accept())
    await copiedTab.locator('.tab-delete').click()

    // Verify it's gone
    await expect(copiedTab).not.toBeVisible({ timeout: 5000 })
  })
})
