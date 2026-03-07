import { test, expect } from './fixtures'

const readSelectionText = async (page) =>
  page.evaluate(() => {
    const selection = window.getSelection?.()
    return selection ? selection.toString() : ''
  })

test.describe('Issue #67 recorded Ctrl+A cascade flow', () => {
  test('Sunday Tasks list selection expands on second Ctrl+A before copy', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.app:not(.app-auth)', { timeout: 15000 })

    const sourcePage = page.locator('.sidebar-title', { hasText: 'Sunday Tasks' }).first()
    const targetPage = page.locator('.sidebar-title', { hasText: 'Test Scratchpad' }).first()
    let seedPagesVisible = true
    try {
      await sourcePage.waitFor({ state: 'visible', timeout: 5000 })
      await targetPage.waitFor({ state: 'visible', timeout: 5000 })
    } catch {
      seedPagesVisible = false
    }
    test.skip(!seedPagesVisible, 'Seed data missing Sunday Tasks / Test Scratchpad pages')

    await sourcePage.click()
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

    const sourceLine = page.locator('.ProseMirror p, .ProseMirror li', { hasText: 'Do core' }).first()
    await sourceLine.click()

    await page.keyboard.press('ControlOrMeta+a')
    const firstSelection = (await readSelectionText(page)).trim()
    await page.keyboard.press('ControlOrMeta+a')
    const secondSelection = (await readSelectionText(page)).trim()

    expect(firstSelection.length).toBeGreaterThan(0)
    expect(secondSelection.length).toBeGreaterThan(firstSelection.length)

    await page.keyboard.press('ControlOrMeta+c')

    await targetPage.click()
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })
    await page.getByText('Go for a run').first().click()
  })
})
