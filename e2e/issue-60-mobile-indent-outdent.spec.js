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
    // A separate list where a non-first parent item HAS its own nested
    // children. Indenting that parent must move ONLY the parent under the
    // previous sibling — its children must stay at their original depth.
    {
      type: 'bulletList',
      attrs: { id: 'bl-nested-1' },
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Groom prep' }] },
          ],
        },
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Bride prep' }] },
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'Alter dress' }] },
                  ],
                },
                {
                  type: 'listItem',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'Buy shoes' }] },
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

        const editor = window.__lifeTrackerEditor
        if (!editor || editor.isDestroyed) {
          throw new Error('Editor test hook is not available')
        }

        const safeOffset = Math.min(targetOffset, textNode.textContent?.length ?? 0)
        const pos = editor.view.posAtDOM(textNode, safeOffset)
        editor.commands.setTextSelection(pos)
        editor.view.focus()
      },
      { selector: paragraphSelector, targetOffset: offset },
    )
  }

  const readListDepthFromSelection = async (page) =>
    page.evaluate(() => {
      const editor = window.__lifeTrackerEditor
      const $from = editor?.state?.selection?.$from
      if (!$from) return 0
      let listDepth = 0
      for (let depth = 0; depth <= $from.depth; depth += 1) {
        const name = $from.node(depth).type?.name
        if (name === 'bulletList' || name === 'orderedList' || name === 'taskList') listDepth += 1
      }
      return listDepth
    })

  // Place the cursor inside the first text node whose content matches `text`,
  // resolved via the editor's document rather than fragile DOM selectors (the
  // nested-list markup makes nth-of-type selectors ambiguous).
  const placeCursorInTextByContent = async (page, text) => {
    await page.evaluate((target) => {
      const editor = window.__lifeTrackerEditor
      if (!editor || editor.isDestroyed) {
        throw new Error('Editor test hook is not available')
      }
      const { doc } = editor.state
      let pos = null
      doc.descendants((node, nodePos) => {
        if (pos !== null) return false
        if (node.isText && node.text === target) {
          pos = nodePos + 1
          return false
        }
        return true
      })
      if (pos === null) throw new Error(`text "${target}" not found in editor`)
      editor.commands.setTextSelection(pos)
      editor.view.focus()
    }, text)
  }

  // Count the list ancestors wrapping the first text node matching `text`.
  const readListDepthOfText = async (page, text) =>
    page.evaluate((target) => {
      const editor = window.__lifeTrackerEditor
      const { doc } = editor.state
      let pos = null
      doc.descendants((node, nodePos) => {
        if (pos !== null) return false
        if (node.isText && node.text === target) {
          pos = nodePos + 1
          return false
        }
        return true
      })
      if (pos === null) return -1
      const $pos = doc.resolve(pos)
      let depth = 0
      for (let d = 0; d <= $pos.depth; d += 1) {
        const name = $pos.node(d).type?.name
        if (name === 'bulletList' || name === 'orderedList' || name === 'taskList') depth += 1
      }
      return depth
    }, text)

  const readSelectedParagraphText = async (page) =>
    page.evaluate(() => {
      const editor = window.__lifeTrackerEditor
      const $from = editor?.state?.selection?.$from
      if (!$from) return null
      for (let depth = $from.depth; depth >= 0; depth -= 1) {
        const node = $from.node(depth)
        if (node.isTextblock) return node.textContent.trim()
      }
      return null
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

  test('mobile: indent/outdent buttons appear and work on list items @mobile', async ({ page, isMobile }) => {
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

  test('mobile: indent/outdent on first list item in table does not create rows @mobile', async ({ page, isMobile }) => {
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

  test('toolbar Indent moves only the parent item, not its nested children', async ({ page, isMobile }) => {
    await waitForApp(page, `/#pg=${testPage.id}`, { expectedText: 'Bride prep' })
    if (isMobile) await ensureToolbarExpanded(page)

    const indentBtn = page.getByTestId('toolbar-indent')
    await expect(indentBtn).toBeVisible()

    // Cursor into "Bride prep" — a non-first parent item that owns a nested
    // child list ("Alter dress", "Buy shoes").
    await placeCursorInTextByContent(page, 'Bride prep')
    await expect(async () => {
      expect(await readSelectedParagraphText(page)).toBe('Bride prep')
    }).toPass({ timeout: 3000 })

    // Baseline depths: parent at 1, its children nested at 2.
    expect(await readListDepthOfText(page, 'Bride prep')).toBe(1)
    expect(await readListDepthOfText(page, 'Alter dress')).toBe(2)
    expect(await readListDepthOfText(page, 'Buy shoes')).toBe(2)

    if (isMobile) await ensureToolbarExpanded(page)
    await indentBtn.click()

    // The parent moves one level deeper (1 -> 2)...
    await expect(async () => {
      expect(await readListDepthOfText(page, 'Bride prep')).toBe(2)
    }).toPass({ timeout: 3000 })

    // ...but its children must NOT be dragged deeper — they stay at depth 2.
    // This is the exact regression: plain sinkListItem pushed them to 3.
    expect(await readListDepthOfText(page, 'Alter dress')).toBe(2)
    expect(await readListDepthOfText(page, 'Buy shoes')).toBe(2)
  })

  test('desktop: indent/outdent buttons are visible @desktop', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop-only check')

    await waitForApp(page, `/#pg=${testPage.id}`, { expectedText: 'Wedding Planning' })

    // Indent/outdent buttons should be available on desktop too
    const indentBtn = page.getByTestId('toolbar-indent')
    const outdentBtn = page.getByTestId('toolbar-outdent')
    await expect(indentBtn).toBeVisible()
    await expect(outdentBtn).toBeVisible()
  })
})
