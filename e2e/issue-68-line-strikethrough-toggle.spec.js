import { test, expect } from './fixtures'

test.describe('Issue #68 strikethrough toggle on entire line', () => {
  const openTestSection = async (page) => {
    await page.goto('/')
    await page.waitForSelector('.app:not(.app-auth)', { timeout: 15000 })

    const testSection = page.locator('.sidebar-title', { hasText: 'Test Section' }).first()
    let seedVisible = true
    try {
      await testSection.waitFor({ state: 'visible', timeout: 5000 })
    } catch {
      seedVisible = false
    }
    return { testSection, seedVisible }
  }

  test('cursor in list item: S button toggles strikethrough on entire line', async ({ page }) => {
    const { testSection, seedVisible } = await openTestSection(page)
    test.skip(!seedVisible, 'Seed data missing Test Section page')

    await testSection.click()
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

    // Find a list item to test
    const listItem = page.locator('.ProseMirror li').first()
    await expect(listItem).toBeVisible({ timeout: 5000 })
    const originalText = await listItem.innerText()

    // Click at end of the list item text (cursor, no selection)
    await listItem.click()
    await page.waitForTimeout(300)

    // Verify no strikethrough initially
    const hasStrikeBefore = await listItem.evaluate((el) => {
      const s = el.querySelector('s')
      return s !== null && s.textContent.trim().length > 0
    })

    // Click the S (strikethrough) toolbar button
    const strikeBtn = page.getByRole('button', { name: 'S', exact: true })
    await strikeBtn.click()
    await page.waitForTimeout(300)

    // The entire line text should now be wrapped in <s> tags
    const hasStrikeAfter = await listItem.evaluate((el) => {
      const s = el.querySelector('s')
      return s !== null && s.textContent.trim().length > 0
    })

    // Strikethrough state should have toggled
    expect(hasStrikeAfter).not.toBe(hasStrikeBefore)

    // Toggle it back off
    await strikeBtn.click()
    await page.waitForTimeout(300)

    const hasStrikeRestored = await listItem.evaluate((el) => {
      const s = el.querySelector('s')
      return s !== null && s.textContent.trim().length > 0
    })
    expect(hasStrikeRestored).toBe(hasStrikeBefore)
  })

  test('cursor in paragraph: S button toggles strikethrough on entire block', async ({ page }) => {
    const { testSection, seedVisible } = await openTestSection(page)
    test.skip(!seedVisible, 'Seed data missing Test Section page')

    await testSection.click()
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

    // Use a paragraph inside a table cell (seed data has "Next Steps:" paragraphs)
    const block = page.locator('.ProseMirror td p').filter({ hasText: 'Next Steps' }).first()
    await expect(block).toBeVisible({ timeout: 5000 })

    await block.click()
    await page.waitForTimeout(300)

    const strikeBtn = page.getByRole('button', { name: 'S', exact: true })

    // Toggle on
    await strikeBtn.click()
    await page.waitForTimeout(300)

    const hasStrike = await block.evaluate((el) => {
      const s = el.querySelector('s')
      return s !== null && s.textContent.trim().length > 0
    })
    expect(hasStrike).toBe(true)

    // Toggle off
    await strikeBtn.click()
    await page.waitForTimeout(300)

    const hasStrikeOff = await block.evaluate((el) => {
      const s = el.querySelector('s')
      return s !== null && s.textContent.trim().length > 0
    })
    expect(hasStrikeOff).toBe(false)
  })

  test('partial selection: S button toggles strikethrough on selected text only', async ({ page }) => {
    const { testSection, seedVisible } = await openTestSection(page)
    test.skip(!seedVisible, 'Seed data missing Test Section page')

    await testSection.click()
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

    const listItem = page.locator('.ProseMirror li').first()
    await expect(listItem).toBeVisible({ timeout: 5000 })

    // Select only part of the text using triple-click then shift+left to deselect end
    const paragraph = listItem.locator('p').first()
    await expect(paragraph).toBeVisible({ timeout: 5000 })
    const fullText = await paragraph.innerText()

    // Use keyboard to select part of the text: Home, then Shift+Right x3
    await paragraph.click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowRight')
    await page.waitForTimeout(200)

    const strikeBtn = page.getByRole('button', { name: 'S', exact: true })
    await strikeBtn.click()
    await page.waitForTimeout(300)

    // Only part of the text should be struck through, not all of it
    const result = await listItem.evaluate((el) => {
      const sEl = el.querySelector('s')
      const allText = el.textContent.trim()
      const struckText = sEl ? sEl.textContent : ''
      return { allText, struckText, hasStrike: sEl !== null }
    })

    expect(result.hasStrike).toBe(true)
    // Struck text should be shorter than full text (partial selection)
    expect(result.struckText.length).toBeLessThan(result.allText.length)

    // Clean up: undo the partial strike with Ctrl+Z
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(300)
  })
})
