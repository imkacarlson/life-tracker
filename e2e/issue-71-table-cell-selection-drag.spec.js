import { test, expect } from './fixtures'
import { getSupabase, createNotebook, createSection, createPage, waitForApp } from './test-helpers'

// Self-contained seed data: a page with a 3x2 table (header row + 2 data rows)
// Using multiple data rows ensures cross-cell drag works reliably
const SEED_CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'table',
      attrs: { id: 'tbl-drag-1' },
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableHeader',
              attrs: { colspan: 1, rowspan: 1 },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Category' }],
                },
              ],
            },
            {
              type: 'tableHeader',
              attrs: { colspan: 1, rowspan: 1 },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Status' }],
                },
              ],
            },
          ],
        },
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              attrs: { colspan: 1, rowspan: 1 },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Running' }],
                },
              ],
            },
            {
              type: 'tableCell',
              attrs: { colspan: 1, rowspan: 1 },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'On track' }],
                },
              ],
            },
          ],
        },
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              attrs: { colspan: 1, rowspan: 1 },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Finance' }],
                },
              ],
            },
            {
              type: 'tableCell',
              attrs: { colspan: 1, rowspan: 1 },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Needs review' }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}

/**
 * Count how many table cells currently have the .selectedCell class,
 * which prosemirror-tables applies when a CellSelection is active.
 */
const countSelectedCells = async (page) => {
  return page.evaluate(() => document.querySelectorAll('.ProseMirror .selectedCell').length)
}

test.describe('Issue #71 cross-cell drag keeps CellSelection', () => {
  let testPage = null

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    const nb = await createNotebook(client, userId, `Issue71 Notebook ${Date.now()}`)
    const sec = await createSection(client, userId, nb.id, 'Issue71 Section')
    testPage = await createPage(client, userId, sec.id, 'Test Scratchpad', SEED_CONTENT)
  })

  test('drag across two table cells produces CellSelection that persists', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Mouse drag CellSelection not supported with touch emulation')
    await waitForApp(page, `/#pg=${testPage.id}`, { expectedText: 'Running' })

    // Use td cells (not th) for reliable cross-cell drag selection
    const cells = page.locator('.ProseMirror table td')
    const cellCount = await cells.count()
    expect(cellCount).toBeGreaterThanOrEqual(2)

    const firstCell = cells.nth(0)
    const secondCell = cells.nth(1)

    const firstBox = await firstCell.boundingBox()
    const secondBox = await secondCell.boundingBox()
    expect(firstBox).toBeTruthy()
    expect(secondBox).toBeTruthy()

    // Drag through cell padding rather than across the text itself. The
    // table-drag plugin resolves anchor/head cells from DOM hit-testing, and
    // the padding path is more stable than dragging through text nodes.
    const startX = firstBox.x + Math.min(12, firstBox.width / 4)
    const startY = firstBox.y + Math.min(12, firstBox.height / 4)
    const endX = secondBox.x + secondBox.width - Math.min(12, secondBox.width / 4)
    const endY = secondBox.y + Math.min(12, secondBox.height / 4)

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(endX, endY, { steps: 20 })
    await page.mouse.up()

    // Wait for CellSelection to stabilize (poll instead of fixed timeout)
    await expect(async () => {
      const selected = await countSelectedCells(page)
      expect(selected).toBeGreaterThanOrEqual(2)
    }).toPass({ timeout: 3000 })
  })

  test('single-cell drag still produces text selection', async ({ page }) => {
    await waitForApp(page, `/#pg=${testPage.id}`, { expectedText: 'Running' })

    const cells = page.locator('.ProseMirror table td')
    const cellCount = await cells.count()
    expect(cellCount).toBeGreaterThanOrEqual(1)

    const cell = cells.nth(0)
    const box = await cell.boundingBox()
    expect(box).toBeTruthy()

    // Drag within the same cell (small horizontal drag)
    const startX = box.x + Math.min(12, box.width / 4)
    const startY = box.y + Math.min(12, box.height / 4)
    const endX = box.x + Math.min(box.width - 12, Math.max(box.width / 2, 24))
    const endY = startY

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(endX, endY, { steps: 10 })
    await page.mouse.up()

    // Should NOT have CellSelection — just normal text selection
    await expect(async () => {
      const selected = await countSelectedCells(page)
      expect(selected).toBe(0)
    }).toPass({ timeout: 3000 })
  })
})
