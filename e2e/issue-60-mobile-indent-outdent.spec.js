import { test, expect } from './fixtures'

test.describe('Issue #60 mobile indent/outdent toolbar buttons', () => {
  test('mobile: indent/outdent buttons appear and work on list items', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Mobile-only toolbar buttons')

    await page.goto('/')
    await page.waitForSelector('.app:not(.app-auth)', { timeout: 15000 })

    // Seed data check: need Test Section page with a list
    const testSection = page.locator('.sidebar-title', { hasText: 'Test Section' }).first()
    let seedVisible = true
    try {
      await testSection.waitFor({ state: 'visible', timeout: 5000 })
    } catch {
      seedVisible = false
    }
    test.skip(!seedVisible, 'Seed data missing Test Section page')

    await testSection.click()
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

    const indentBtn = page.getByRole('button', { name: '→' })
    const outdentBtn = page.getByRole('button', { name: '←' })

    // Buttons should be visible on mobile
    await expect(indentBtn).toBeVisible()
    await expect(outdentBtn).toBeVisible()

    // Find a non-first list item to test indent/outdent
    const weddingInvites = page.getByText('Send out wedding invites').first()
    await expect(weddingInvites).toBeVisible({ timeout: 5000 })

    // Click the item and indent it
    await weddingInvites.click()
    await page.waitForTimeout(300)

    // Capture table row count before indent
    const rowCountBefore = await page.evaluate(() =>
      document.querySelectorAll('table tr').length
    )

    // Indent: the item should become nested
    await indentBtn.click()
    await page.waitForTimeout(500)

    // Verify indentation happened — item should now be inside a nested list
    const isNested = await page.evaluate(() => {
      const sel = window.getSelection()
      if (!sel?.anchorNode) return false
      let node = sel.anchorNode
      let listDepth = 0
      while (node && node !== document.body) {
        if (node.nodeName === 'UL' || node.nodeName === 'OL') listDepth++
        node = node.parentNode
      }
      return listDepth >= 2
    })
    expect(isNested).toBe(true)

    // Outdent: should return to original level
    await outdentBtn.click()
    await page.waitForTimeout(500)

    const isFlat = await page.evaluate(() => {
      const sel = window.getSelection()
      if (!sel?.anchorNode) return false
      let node = sel.anchorNode
      let listDepth = 0
      while (node && node !== document.body) {
        if (node.nodeName === 'UL' || node.nodeName === 'OL') listDepth++
        node = node.parentNode
      }
      return listDepth === 1
    })
    expect(isFlat).toBe(true)

    // Table row count should be unchanged (no spurious rows created)
    const rowCountAfter = await page.evaluate(() =>
      document.querySelectorAll('table tr').length
    )
    expect(rowCountAfter).toBe(rowCountBefore)
  })

  test('mobile: indent/outdent on first list item in table does not create rows', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Mobile-only toolbar buttons')

    await page.goto('/')
    await page.waitForSelector('.app:not(.app-auth)', { timeout: 15000 })

    const testSection = page.locator('.sidebar-title', { hasText: 'Test Section' }).first()
    let seedVisible = true
    try {
      await testSection.waitFor({ state: 'visible', timeout: 5000 })
    } catch {
      seedVisible = false
    }
    test.skip(!seedVisible, 'Seed data missing Test Section page')

    await testSection.click()
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

    const indentBtn = page.getByRole('button', { name: '→' })
    const outdentBtn = page.getByRole('button', { name: '←' })

    // Click on the first list item (can't be indented or outdented)
    const djItem = page.getByText('Get DJ scheduled').first()
    await expect(djItem).toBeVisible({ timeout: 5000 })
    await djItem.click()
    await page.waitForTimeout(300)

    const rowCountBefore = await page.evaluate(() =>
      document.querySelectorAll('table tr').length
    )

    // Indent on first item should be a no-op
    await indentBtn.click()
    await page.waitForTimeout(500)

    // Outdent on top-level item in table should be a no-op
    await outdentBtn.click()
    await page.waitForTimeout(500)

    // Table should have same number of rows — no spurious rows created
    const rowCountAfter = await page.evaluate(() =>
      document.querySelectorAll('table tr').length
    )
    expect(rowCountAfter).toBe(rowCountBefore)
  })

  test('desktop: indent/outdent buttons are not visible', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop-only check')

    await page.goto('/')
    await page.waitForSelector('.app:not(.app-auth)', { timeout: 15000 })

    const testSection = page.locator('.sidebar-title', { hasText: 'Test Section' }).first()
    let seedVisible = true
    try {
      await testSection.waitFor({ state: 'visible', timeout: 5000 })
    } catch {
      seedVisible = false
    }
    test.skip(!seedVisible, 'Seed data missing Test Section page')

    await testSection.click()
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

    // Indent/outdent buttons should not exist on desktop
    const indentBtn = page.getByRole('button', { name: '→' })
    const outdentBtn = page.getByRole('button', { name: '←' })
    await expect(indentBtn).not.toBeVisible()
    await expect(outdentBtn).not.toBeVisible()
  })
})
