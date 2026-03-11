import { test, expect } from './fixtures'

/**
 * Count how many table cells currently have the .selectedCell class,
 * which prosemirror-tables applies when a CellSelection is active.
 */
const countSelectedCells = async (page) => {
  return page.evaluate(() => document.querySelectorAll('.ProseMirror .selectedCell').length)
}

test.describe('Issue #71 cross-cell drag keeps CellSelection', () => {
  test('drag across two table cells produces CellSelection that persists', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.app:not(.app-auth)', { timeout: 15000 })

    // Open Test Scratchpad which has table seed data
    const scratchpad = page.locator('.sidebar-title', { hasText: 'Test Scratchpad' }).first()
    let seedVisible = true
    try {
      await scratchpad.waitFor({ state: 'visible', timeout: 5000 })
    } catch {
      seedVisible = false
    }
    test.skip(!seedVisible, 'Seed data missing Test Scratchpad page')

    await scratchpad.click()
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

    // Find a table with at least two cells
    const cells = page.locator('.ProseMirror table td, .ProseMirror table th')
    const cellCount = await cells.count()
    test.skip(cellCount < 2, 'Seed data missing table with at least 2 cells')

    const firstCell = cells.nth(0)
    const secondCell = cells.nth(1)

    const firstBox = await firstCell.boundingBox()
    const secondBox = await secondCell.boundingBox()
    expect(firstBox).toBeTruthy()
    expect(secondBox).toBeTruthy()

    // Simulate drag from center of first cell to center of second cell
    const startX = firstBox.x + firstBox.width / 2
    const startY = firstBox.y + firstBox.height / 2
    const endX = secondBox.x + secondBox.width / 2
    const endY = secondBox.y + secondBox.height / 2

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    // Move in steps to trigger cross-cell detection
    const steps = 10
    for (let i = 1; i <= steps; i++) {
      const x = startX + ((endX - startX) * i) / steps
      const y = startY + ((endY - startY) * i) / steps
      await page.mouse.move(x, y)
    }
    await page.mouse.up()

    // Wait for selection to stabilize
    await page.waitForTimeout(500)

    // Verify CellSelection persists with multiple cells highlighted
    const selected = await countSelectedCells(page)
    expect(selected).toBeGreaterThanOrEqual(2)
  })

  test('single-cell drag still produces text selection', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.app:not(.app-auth)', { timeout: 15000 })

    const scratchpad = page.locator('.sidebar-title', { hasText: 'Test Scratchpad' }).first()
    let seedVisible = true
    try {
      await scratchpad.waitFor({ state: 'visible', timeout: 5000 })
    } catch {
      seedVisible = false
    }
    test.skip(!seedVisible, 'Seed data missing Test Scratchpad page')

    await scratchpad.click()
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

    const cells = page.locator('.ProseMirror table td, .ProseMirror table th')
    const cellCount = await cells.count()
    test.skip(cellCount < 1, 'Seed data missing table with at least 1 cell')

    const cell = cells.nth(0)
    const box = await cell.boundingBox()
    expect(box).toBeTruthy()

    // Drag within the same cell (small horizontal drag)
    const startX = box.x + 10
    const startY = box.y + box.height / 2
    const endX = box.x + Math.min(box.width - 10, 100)
    const endY = startY

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(startX + ((endX - startX) * i) / 5, endY)
    }
    await page.mouse.up()

    await page.waitForTimeout(300)

    // Should NOT have CellSelection — just normal text selection
    const selected = await countSelectedCells(page)
    expect(selected).toBe(0)
  })
})
