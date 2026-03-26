import { test, expect } from './fixtures'
import { getSupabase, createNotebook, createSection, createPage, waitForApp } from './test-helpers'

// Self-contained seed data: a page with a bullet list inside a table
// (tests that indent/outdent in a table cell doesn't create spurious rows)
const SEED_CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'table',
      attrs: { id: 'tbl-indent-1' },
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
                  content: [{ type: 'text', text: 'Wedding Planning' }],
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
                  type: 'bulletList',
                  attrs: { id: 'bl-indent-1' },
                  content: [
                    {
                      type: 'listItem',
                      content: [
                        {
                          type: 'paragraph',
                          content: [{ type: 'text', text: 'Get DJ scheduled' }],
                        },
                      ],
                    },
                    {
                      type: 'listItem',
                      content: [
                        {
                          type: 'paragraph',
                          content: [{ type: 'text', text: 'Send out wedding invites' }],
                        },
                      ],
                    },
                    {
                      type: 'listItem',
                      content: [
                        {
                          type: 'paragraph',
                          content: [{ type: 'text', text: 'Book photographer' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}

test.describe('Issue #60 mobile indent/outdent toolbar buttons', () => {
  let testPage = null

  const ensureMobileToolbarExpanded = async (page) => {
    const toolbar = page.locator('.toolbar')
    await expect(toolbar).toHaveAttribute('data-expanded', 'true', { timeout: 5000 })
  }

  const readListDepthFromSelection = async (page) =>
    page.evaluate(() => {
      const sel = window.getSelection()
      if (!sel?.anchorNode) return 0
      let node = sel.anchorNode
      let listDepth = 0
      while (node && node !== document.body) {
        if (node.nodeName === 'UL' || node.nodeName === 'OL') listDepth++
        node = node.parentNode
      }
      return listDepth
    })

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    const nb = await createNotebook(client, userId, `Issue60 Notebook ${Date.now()}`)
    const sec = await createSection(client, userId, nb.id, 'Issue60 Section')
    testPage = await createPage(client, userId, sec.id, 'Test Section', SEED_CONTENT)
  })

  test('mobile: indent/outdent buttons appear and work on list items', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Mobile-only toolbar buttons')

    await waitForApp(page, `/#pg=${testPage.id}`, { expectedText: 'Send out wedding invites' })
    await ensureMobileToolbarExpanded(page)

    const indentBtn = page.getByTestId('toolbar-indent')
    const outdentBtn = page.getByTestId('toolbar-outdent')

    // Buttons should be visible on mobile
    await expect(indentBtn).toBeVisible()
    await expect(outdentBtn).toBeVisible()

    // Find a non-first list item to test indent/outdent
    const weddingInvites = page.getByText('Send out wedding invites').first()

    // Click the item and indent it
    await weddingInvites.click()
    await expect(async () => {
      expect(await readListDepthFromSelection(page)).toBe(1)
    }).toPass({ timeout: 3000 })

    // Capture table row count before indent
    const rowCountBefore = await page.evaluate(() =>
      document.querySelectorAll('table tr').length
    )

    // Indent: the item should become nested
    await ensureMobileToolbarExpanded(page)
    await indentBtn.click()
    await expect(async () => {
      expect(await readListDepthFromSelection(page)).toBeGreaterThanOrEqual(2)
    }).toPass({ timeout: 3000 })

    // Outdent: should return to original level
    await ensureMobileToolbarExpanded(page)
    await outdentBtn.click()
    await expect(async () => {
      expect(await readListDepthFromSelection(page)).toBe(1)
    }).toPass({ timeout: 3000 })

    // Table row count should be unchanged (no spurious rows created)
    const rowCountAfter = await page.evaluate(() =>
      document.querySelectorAll('table tr').length
    )
    expect(rowCountAfter).toBe(rowCountBefore)
  })

  test('mobile: indent/outdent on first list item in table does not create rows', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Mobile-only toolbar buttons')

    await waitForApp(page, `/#pg=${testPage.id}`, { expectedText: 'Get DJ scheduled' })
    await ensureMobileToolbarExpanded(page)

    const indentBtn = page.getByTestId('toolbar-indent')
    const outdentBtn = page.getByTestId('toolbar-outdent')

    // Click on the first list item (can't be indented or outdented)
    const djItem = page.getByText('Get DJ scheduled').first()
    await expect(djItem).toBeVisible({ timeout: 5000 })
    await djItem.click()
    await expect(async () => {
      expect(await readListDepthFromSelection(page)).toBe(1)
    }).toPass({ timeout: 3000 })

    const rowCountBefore = await page.evaluate(() =>
      document.querySelectorAll('table tr').length
    )

    // Indent on first item should be a no-op
    await indentBtn.click()

    // Outdent on top-level item in table should be a no-op
    await outdentBtn.click()
    await expect(async () => {
      expect(await readListDepthFromSelection(page)).toBe(1)
    }).toPass({ timeout: 3000 })

    // Table should have same number of rows — no spurious rows created
    const rowCountAfter = await page.evaluate(() =>
      document.querySelectorAll('table tr').length
    )
    expect(rowCountAfter).toBe(rowCountBefore)
  })

  test('desktop: indent/outdent buttons are not visible', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop-only check')

    await waitForApp(page, `/#pg=${testPage.id}`, { expectedText: 'Wedding Planning' })

    // Indent/outdent buttons should not exist on desktop
    const indentBtn = page.getByTestId('toolbar-indent')
    const outdentBtn = page.getByTestId('toolbar-outdent')
    await expect(indentBtn).not.toBeVisible()
    await expect(outdentBtn).not.toBeVisible()
  })
})
