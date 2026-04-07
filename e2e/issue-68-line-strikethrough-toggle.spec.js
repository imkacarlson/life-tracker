import { test, expect } from './fixtures'
import {
  getSupabase,
  createNotebook,
  createSection,
  createPage,
  waitForApp,
  ensureToolbarExpanded,
} from './test-helpers'

// Self-contained seed data: a page with a list item and a table with "Next Steps" paragraph
const SEED_CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'bulletList',
      attrs: { id: 'bl-strike-1' },
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              attrs: { id: 'p-strike-li' },
              content: [{ type: 'text', text: 'Review quarterly goals' }],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              attrs: { id: 'p-strike-li2' },
              content: [{ type: 'text', text: 'Send out wedding invites' }],
            },
          ],
        },
      ],
    },
    {
      type: 'table',
      attrs: { id: 'tbl-strike-1' },
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              attrs: { colspan: 1, rowspan: 1 },
              content: [
                {
                  type: 'paragraph',
                  attrs: { id: 'p-strike-next' },
                  content: [{ type: 'text', text: 'Next Steps: finalize budget' }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}

test.describe('Issue #68 strikethrough toggle on entire line', () => {
  let testPage = null

  const getStrikeButton = (page) => page.getByTestId('toolbar-strikethrough')

  const selectTextRangeInParagraph = async (page, paragraphSelector, startOffset, endOffset) => {
    await page.evaluate(
      ({ selector, start, end }) => {
        const paragraph = document.querySelector(selector)
        const textNode = paragraph?.firstChild
        if (!paragraph || !textNode || textNode.nodeType !== Node.TEXT_NODE) {
          throw new Error('Could not resolve paragraph text node for selection')
        }
        const range = document.createRange()
        range.setStart(textNode, start)
        range.setEnd(textNode, end)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      },
      { selector: paragraphSelector, start: startOffset, end: endOffset },
    )
  }

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    const nb = await createNotebook(client, userId, `Issue68 Notebook ${Date.now()}`)
    const sec = await createSection(client, userId, nb.id, 'Issue68 Section')
    testPage = await createPage(client, userId, sec.id, 'Test Section', SEED_CONTENT)
  })

  test('cursor in list item: S button toggles strikethrough on entire line', async ({ page }) => {
    await waitForApp(page, `/#pg=${testPage.id}`, { expectedText: 'Review quarterly goals' })

    // Find a list item to test
    const listItem = page.locator('.ProseMirror li').first()

    // Click at end of the list item text (cursor, no selection)
    await listItem.click()
    await expect(listItem).toBeVisible({ timeout: 5000 })

    // Verify no strikethrough initially
    const hasStrikeBefore = await listItem.evaluate((el) => {
      const s = el.querySelector('s')
      return s !== null && s.textContent.trim().length > 0
    })

    // Click the S (strikethrough) toolbar button
    await ensureToolbarExpanded(page)
    const strikeBtn = getStrikeButton(page)
    await strikeBtn.click()
    await expect(async () => {
      const hasStrikeAfter = await listItem.evaluate((el) => {
        const s = el.querySelector('s')
        return s !== null && s.textContent.trim().length > 0
      })
      expect(hasStrikeAfter).not.toBe(hasStrikeBefore)
    }).toPass({ timeout: 3000 })

    await ensureToolbarExpanded(page)
    await strikeBtn.click()
    await expect(async () => {
      const hasStrikeRestored = await listItem.evaluate((el) => {
        const s = el.querySelector('s')
        return s !== null && s.textContent.trim().length > 0
      })
      expect(hasStrikeRestored).toBe(hasStrikeBefore)
    }).toPass({ timeout: 3000 })
  })

  test('cursor in paragraph: S button toggles strikethrough on entire block', async ({ page }) => {
    await waitForApp(page, `/#pg=${testPage.id}`, { expectedText: 'Next Steps' })

    // Use a paragraph inside a table cell (seed data has "Next Steps:" paragraph)
    const block = page.locator('.ProseMirror td p').filter({ hasText: 'Next Steps' }).first()

    await block.click({ position: { x: 8, y: 8 } })

    await ensureToolbarExpanded(page)
    const strikeBtn = getStrikeButton(page)

    // Toggle on
    await strikeBtn.click()

    // Wait for strikethrough to appear (poll instead of fixed timeout)
    await expect(async () => {
      const hasStrike = await block.evaluate((el) => {
        const s = el.querySelector('s')
        return s !== null && s.textContent.trim().length > 0
      })
      expect(hasStrike).toBe(true)
    }).toPass({ timeout: 3000 })

    // Toggle off
    await ensureToolbarExpanded(page)
    await strikeBtn.click()
    await expect(async () => {
      const hasStrikeOff = await block.evaluate((el) => {
        const s = el.querySelector('s')
        return s !== null && s.textContent.trim().length > 0
      })
      expect(hasStrikeOff).toBe(false)
    }).toPass({ timeout: 3000 })
  })

  test('partial selection: S button toggles strikethrough on selected text only', async ({ page }) => {
    await waitForApp(page, `/#pg=${testPage.id}`, { expectedText: 'Review quarterly goals' })

    const listItem = page.locator('.ProseMirror li').first()
    const paragraph = listItem.locator('p').first()
    await expect(paragraph).toBeVisible({ timeout: 5000 })

    await paragraph.click()
    await selectTextRangeInParagraph(page, '.ProseMirror li:first-of-type p', 0, 3)

    await ensureToolbarExpanded(page)
    const strikeBtn = getStrikeButton(page)
    await strikeBtn.click()
    await expect(async () => {
      const result = await listItem.evaluate((el) => {
        const sEl = el.querySelector('s')
        const allText = el.textContent.trim()
        const struckText = sEl ? sEl.textContent : ''
        return { allText, struckText, hasStrike: sEl !== null }
      })

      expect(result.hasStrike).toBe(true)
      expect(result.struckText.length).toBeLessThan(result.allText.length)
    }).toPass({ timeout: 3000 })

    // Clean up: undo the partial strike with Ctrl+Z
    await page.keyboard.press('Control+z')
    await expect(async () => {
      const hasStrike = await listItem.evaluate((el) => {
        const s = el.querySelector('s')
        return s !== null && s.textContent.trim().length > 0
      })
      expect(hasStrike).toBe(false)
    }).toPass({ timeout: 3000 })
  })
})
