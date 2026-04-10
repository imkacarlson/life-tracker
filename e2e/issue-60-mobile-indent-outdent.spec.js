import { test, expect } from './fixtures'
import {
  getSupabase,
  createNotebook,
  createSection,
  createPage,
  deleteNotebookById,
  waitForApp,
  ensureToolbarExpanded,
} from './test-helpers'

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
  let notebookId = null
  let testPage = null

  const placeCursorInParagraph = async (page, paragraphSelector, offset = 0) => {
    await page.evaluate(
      ({ selector, targetOffset }) => {
        const paragraph = document.querySelector(selector)
        const textNode = paragraph?.firstChild
        if (!paragraph || !textNode || textNode.nodeType !== Node.TEXT_NODE) {
          throw new Error('Could not resolve paragraph text node for cursor placement')
        }

        const safeOffset = Math.min(targetOffset, textNode.textContent?.length ?? 0)
        const range = document.createRange()
        range.setStart(textNode, safeOffset)
        range.collapse(true)

        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)

        const editorRoot = paragraph.closest('.ProseMirror')
        if (editorRoot instanceof HTMLElement) {
          editorRoot.focus()
        }
      },
      { selector: paragraphSelector, targetOffset: offset },
    )
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

  const readSelectedParagraphText = async (page) =>
    page.evaluate(() => {
      const selection = window.getSelection()
      const anchorNode = selection?.anchorNode
      if (!anchorNode) return null
      const anchorElement = anchorNode.nodeType === Node.TEXT_NODE ? anchorNode.parentElement : anchorNode
      return anchorElement?.closest('p')?.textContent?.trim() ?? null
    })

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    const nb = await createNotebook(client, userId, `Issue60 Notebook ${Date.now()}`)
    notebookId = nb.id
    const sec = await createSection(client, userId, nb.id, 'Issue60 Section')
    testPage = await createPage(client, userId, sec.id, 'Test Section', SEED_CONTENT)
  })

  test.afterAll(async () => {
    const { client } = await getSupabase()
    await deleteNotebookById(client, notebookId)
  })

  test('mobile: indent/outdent buttons appear and work on list items', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Mobile-only toolbar buttons')

    await waitForApp(page, `/#pg=${testPage.id}`, { expectedText: 'Send out wedding invites' })
    await ensureToolbarExpanded(page)

    const indentBtn = page.getByTestId('toolbar-indent')
    const outdentBtn = page.getByTestId('toolbar-outdent')

    // Buttons should be visible on mobile
    await expect(indentBtn).toBeVisible()
    await expect(outdentBtn).toBeVisible()

    // Find a non-first list item to test indent/outdent
    // Place the cursor in the second list item explicitly. A mobile text tap can
    // leave the selection on the first item under emulation, which makes indent
    // a no-op because the first item is intentionally non-indentable.
    await placeCursorInParagraph(page, '.ProseMirror li:nth-of-type(2) p', 1)
    await expect(async () => {
      expect(await readSelectedParagraphText(page)).toBe('Send out wedding invites')
    }).toPass({ timeout: 3000 })
    await expect(async () => {
      expect(await readListDepthFromSelection(page)).toBe(1)
    }).toPass({ timeout: 3000 })

    // Capture table row count before indent
    const rowCountBefore = await page.evaluate(() =>
      document.querySelectorAll('table tr').length
    )

    // Indent: the item should become nested
    await ensureToolbarExpanded(page)
    await indentBtn.click()
    await expect(async () => {
      expect(await readListDepthFromSelection(page)).toBeGreaterThanOrEqual(2)
    }).toPass({ timeout: 3000 })

    // Outdent: should return to original level
    await ensureToolbarExpanded(page)
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
    await ensureToolbarExpanded(page)

    const indentBtn = page.getByTestId('toolbar-indent')
    const outdentBtn = page.getByTestId('toolbar-outdent')

    // Click on the first list item (can't be indented or outdented)
    await expect(page.getByText('Get DJ scheduled').first()).toBeVisible({ timeout: 5000 })
    await placeCursorInParagraph(page, '.ProseMirror li:nth-of-type(1) p', 1)
    await expect(async () => {
      expect(await readSelectedParagraphText(page)).toBe('Get DJ scheduled')
    }).toPass({ timeout: 3000 })
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
