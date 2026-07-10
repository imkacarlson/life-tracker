import { test, expect } from './fixtures'
import {
  getSupabase,
  createNotebook,
  createSection,
  createPage,
  deleteNotebookById,
  waitForApp,
} from './test-helpers'

// A paragraph with mixed inline marks: bold + highlight on the same text.
const MIXED_MARKS_CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id: 'p-clear-mixed' },
      content: [
        {
          type: 'text',
          marks: [{ type: 'bold' }, { type: 'highlight', attrs: { color: '#fef08a' } }],
          text: 'Fully formatted line',
        },
      ],
    },
  ],
}

// A paragraph where only part of the text is formatted, for the partial-selection case.
const PARTIAL_MARKS_CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id: 'p-clear-partial' },
      content: [
        { type: 'text', marks: [{ type: 'bold' }], text: 'Keep bold ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'clear this' },
      ],
    },
  ],
}

// A bullet list item whose text is formatted, to prove block structure survives.
const LIST_MARKS_CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'bulletList',
      attrs: { id: 'bl-clear-1' },
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              attrs: { id: 'p-clear-li' },
              content: [
                {
                  type: 'text',
                  marks: [{ type: 'bold' }, { type: 'highlight', attrs: { color: '#fef08a' } }],
                  text: 'Formatted list item',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}

test.describe('Clear inline formatting shortcut (Ctrl+\\)', () => {
  let notebookId = null
  let mixedPage = null
  let partialPage = null
  let listPage = null

  // Place a collapsed caret with the browser's own click/tap path, matching the
  // strike-toggle spec so DOM-selection sync is exercised on touch emulation too.
  const placeCaretInBlock = async (page, block) => {
    const isTouchOnly = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
    if (isTouchOnly) {
      await page.locator('.ProseMirror').evaluate((node) => node.focus({ preventScroll: true }))
      await block.tap()
      return
    }
    await block.click()
  }

  const selectTextRangeInParagraph = async (page, paragraphSelector, startOffset, endOffset) => {
    await page.evaluate(
      ({ selector, start, end }) => {
        const paragraph = document.querySelector(selector)
        if (!paragraph) {
          throw new Error('Could not resolve paragraph text node for selection')
        }
        const range = document.createRange()
        const textNodes = []
        const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
        while (walker.nextNode()) {
          textNodes.push(walker.currentNode)
        }
        if (textNodes.length === 0) {
          throw new Error('Could not resolve paragraph text node for selection')
        }

        const resolveOffset = (offset) => {
          let remaining = offset
          for (const node of textNodes) {
            if (remaining <= node.textContent.length) {
              return { node, offset: remaining }
            }
            remaining -= node.textContent.length
          }
          const lastNode = textNodes[textNodes.length - 1]
          return { node: lastNode, offset: lastNode.textContent.length }
        }

        const startPoint = resolveOffset(start)
        const endPoint = resolveOffset(end)
        range.setStart(startPoint.node, startPoint.offset)
        range.setEnd(endPoint.node, endPoint.offset)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      },
      { selector: paragraphSelector, start: startOffset, end: endOffset },
    )
  }

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    const nb = await createNotebook(client, userId, `ClearFmt Notebook ${Date.now()}`)
    notebookId = nb.id
    const sec = await createSection(client, userId, nb.id, 'ClearFmt Section')
    mixedPage = await createPage(client, userId, sec.id, 'Mixed Marks', MIXED_MARKS_CONTENT)
    partialPage = await createPage(client, userId, sec.id, 'Partial Marks', PARTIAL_MARKS_CONTENT, 1)
    listPage = await createPage(client, userId, sec.id, 'List Marks', LIST_MARKS_CONTENT, 2)
  })

  test.afterAll(async () => {
    const { client } = await getSupabase()
    await deleteNotebookById(client, notebookId)
  })

  test('cursor, no selection: clears all inline marks on the whole line', async ({ page }) => {
    await waitForApp(page, `/#pg=${mixedPage.id}`, { expectedText: 'Fully formatted line' })

    const block = page.locator('.ProseMirror p', { hasText: 'Fully formatted line' }).first()
    await expect(block).toBeVisible({ timeout: 5000 })
    await placeCaretInBlock(page, block)

    await page.keyboard.press('Control+\\')

    await expect(async () => {
      const result = await block.evaluate((el) => ({
        text: el.textContent.trim(),
        hasBold: el.querySelector('strong') !== null,
        hasHighlight: el.querySelector('mark') !== null,
      }))
      // All inline marks gone, text content unchanged
      expect(result.hasBold).toBe(false)
      expect(result.hasHighlight).toBe(false)
      expect(result.text).toBe('Fully formatted line')
    }).toPass({ timeout: 3000 })
  })

  test('partial selection: clears only the selected span, rest keeps its marks', async ({ page }) => {
    await waitForApp(page, `/#pg=${partialPage.id}`, { expectedText: 'clear this' })

    const block = page.locator('.ProseMirror p', { hasText: 'clear this' }).first()
    await expect(block).toBeVisible({ timeout: 5000 })
    await block.click()

    // Select "clear this" (chars 10..20 of "Keep bold clear this")
    await selectTextRangeInParagraph(page, '#p-clear-partial', 10, 20)

    await page.keyboard.press('Control+\\')

    await expect(async () => {
      const result = await block.evaluate((el) => ({
        text: el.textContent.trim(),
        boldText: Array.from(el.querySelectorAll('strong'))
          .map((n) => n.textContent ?? '')
          .join(''),
      }))
      // "Keep bold " stays bold; "clear this" is now plain
      expect(result.text).toBe('Keep bold clear this')
      expect(result.boldText).toContain('Keep bold')
      expect(result.boldText).not.toContain('clear this')
    }).toPass({ timeout: 3000 })
  })

  test('inside a bullet list: clears marks but list structure remains', async ({ page }) => {
    await waitForApp(page, `/#pg=${listPage.id}`, { expectedText: 'Formatted list item' })

    const listItem = page.locator('.ProseMirror li').first()
    await expect(listItem).toBeVisible({ timeout: 5000 })
    await placeCaretInBlock(page, listItem)

    await page.keyboard.press('Control+\\')

    await expect(async () => {
      const result = await page.evaluate(() => {
        const li = document.querySelector('.ProseMirror li')
        return {
          text: li?.textContent.trim() ?? '',
          hasBold: li?.querySelector('strong') !== null,
          hasHighlight: li?.querySelector('mark') !== null,
          listItemCount: document.querySelectorAll('.ProseMirror li').length,
          hasBulletList: document.querySelector('.ProseMirror ul') !== null,
        }
      })
      expect(result.hasBold).toBe(false)
      expect(result.hasHighlight).toBe(false)
      expect(result.text).toBe('Formatted list item')
      // Block structure untouched
      expect(result.hasBulletList).toBe(true)
      expect(result.listItemCount).toBe(1)
    }).toPass({ timeout: 3000 })
  })
})
