import { test, expect } from './fixtures'
import {
  getSupabase,
  createNotebook,
  createSection,
  createPage,
  deleteNotebookById,
  ensureToolbarExpanded,
  waitForApp,
} from './test-helpers'

// One paragraph with a word to highlight plus a trailing word that must stay
// untouched, so we can prove the shortcut grabs the WHOLE word and nothing more.
const HIGHLIGHT_CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id: 'p-hl' },
      content: [{ type: 'text', text: 'highlightme extra' }],
    },
  ],
}

// Three separate lines, one per inline mark, so each toggle is independent.
const LINE_CONTENT = {
  type: 'doc',
  content: [
    { type: 'paragraph', attrs: { id: 'p-bold' }, content: [{ type: 'text', text: 'bold this whole line' }] },
    { type: 'paragraph', attrs: { id: 'p-italic' }, content: [{ type: 'text', text: 'italic this whole line' }] },
    { type: 'paragraph', attrs: { id: 'p-underline' }, content: [{ type: 'text', text: 'underline this whole line' }] },
  ],
}

// An empty block (arm-only) plus a word to prove arming after formatting a word.
const ARM_CONTENT = {
  type: 'doc',
  content: [
    { type: 'paragraph', attrs: { id: 'p-arm-empty' } },
    { type: 'paragraph', attrs: { id: 'p-arm-word' }, content: [{ type: 'text', text: 'wordone' }] },
  ],
}

const PARITY_CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id: 'p-parity' },
      content: [{ type: 'text', text: 'parityword extra' }],
    },
  ],
}

test.describe('Formatting keyboard shortcuts (match toolbar smart behavior)', () => {
  let notebookId = null
  let highlightPage = null
  let linePage = null
  let armPage = null
  let parityPage = null

  // Focus the editor, then place a COLLAPSED caret at a precise character offset
  // inside a paragraph. Focusing first keeps the editor active so the keyboard
  // shortcut reaches ProseMirror; setting the DOM selection drives the smart
  // target (word/line) via syncSelectionFromDom, exactly like a real click+caret.
  const placeCaretInParagraph = async (page, selector, offset) => {
    const block = page.locator(`#${selector}`)
    await expect(block).toBeVisible({ timeout: 5000 })
    const isTouchOnly = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
    if (isTouchOnly) {
      await page.locator('.ProseMirror').evaluate((node) => node.focus({ preventScroll: true }))
      await block.tap()
    } else {
      await block.click()
    }

    await page.evaluate(
      ({ sel, off }) => {
        const paragraph = document.getElementById(sel)
        if (!paragraph) throw new Error(`Missing paragraph #${sel}`)
        const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
        const textNodes = []
        while (walker.nextNode()) textNodes.push(walker.currentNode)

        const range = document.createRange()
        if (textNodes.length === 0) {
          // Empty block: collapse into the paragraph element itself.
          range.setStart(paragraph, 0)
        } else {
          let remaining = off
          let target = textNodes[textNodes.length - 1]
          let targetOffset = target.textContent.length
          for (const node of textNodes) {
            if (remaining <= node.textContent.length) {
              target = node
              targetOffset = remaining
              break
            }
            remaining -= node.textContent.length
          }
          range.setStart(target, targetOffset)
        }
        range.collapse(true)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      },
      { sel: selector, off: offset },
    )
  }

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    const nb = await createNotebook(client, userId, `FmtShortcuts Notebook ${Date.now()}`)
    notebookId = nb.id
    const sec = await createSection(client, userId, nb.id, 'FmtShortcuts Section')
    highlightPage = await createPage(client, userId, sec.id, 'Highlight Word', HIGHLIGHT_CONTENT)
    linePage = await createPage(client, userId, sec.id, 'Line Marks', LINE_CONTENT, 1)
    armPage = await createPage(client, userId, sec.id, 'Arm Typing', ARM_CONTENT, 2)
    parityPage = await createPage(client, userId, sec.id, 'Parity', PARITY_CONTENT, 3)
  })

  test.afterAll(async () => {
    const { client } = await getSupabase()
    await deleteNotebookById(client, notebookId)
  })

  test('highlight shortcut on a word marks the whole word and toggles off', async ({ page }) => {
    await waitForApp(page, `/#pg=${highlightPage.id}`, { expectedText: 'highlightme extra' })
    const block = page.locator('#p-hl')

    // Caret inside "highlightme" (offset 3), nothing selected.
    await placeCaretInParagraph(page, 'p-hl', 3)
    await page.keyboard.press('Control+Alt+h')

    // Whole word wrapped in <mark>; "extra" untouched. (The exact reported bug.)
    await expect(async () => {
      const result = await block.evaluate((el) => ({
        markText: el.querySelector('mark')?.textContent ?? '',
        text: el.textContent.trim(),
      }))
      expect(result.markText).toBe('highlightme')
      expect(result.text).toBe('highlightme extra')
    }).toPass({ timeout: 3000 })

    // Press again -> highlight removed.
    await placeCaretInParagraph(page, 'p-hl', 3)
    await page.keyboard.press('Control+Alt+h')
    await expect(async () => {
      const hasMark = await block.evaluate((el) => el.querySelector('mark') !== null)
      expect(hasMark).toBe(false)
    }).toPass({ timeout: 3000 })
  })

  test('bold/italic/underline shortcuts format the whole line', async ({ page }) => {
    await waitForApp(page, `/#pg=${linePage.id}`, { expectedText: 'bold this whole line' })

    const cases = [
      { selector: 'p-bold', key: 'Control+b', tag: 'strong', text: 'bold this whole line' },
      { selector: 'p-italic', key: 'Control+i', tag: 'em', text: 'italic this whole line' },
      { selector: 'p-underline', key: 'Control+u', tag: 'u', text: 'underline this whole line' },
    ]

    for (const { selector, key, tag, text } of cases) {
      // Caret mid-line, nothing selected.
      await placeCaretInParagraph(page, selector, 4)
      await page.keyboard.press(key)

      await expect(async () => {
        const marked = await page
          .locator(`#${selector} ${tag}`)
          .evaluate((el) => el.textContent)
          .catch(() => null)
        expect(marked).toBe(text)
      }).toPass({ timeout: 3000 })
    }
  })

  test('shortcut arms continued typing (empty block and after a word)', async ({ page }) => {
    await waitForApp(page, `/#pg=${armPage.id}`, { expectedText: 'wordone' })

    // 1) Empty block: nothing to format, so Ctrl+i just arms; typed text is italic.
    await placeCaretInParagraph(page, 'p-arm-empty', 0)
    await page.keyboard.press('Control+i')
    await page.keyboard.type('freshitalic')
    await expect(async () => {
      const emText = await page
        .locator('#p-arm-empty em')
        .evaluate((el) => el.textContent)
        .catch(() => null)
      expect(emText).toContain('freshitalic')
    }).toPass({ timeout: 3000 })

    // 2) After highlighting a word, typing inside it stays highlighted (armed).
    await placeCaretInParagraph(page, 'p-arm-word', 3)
    await page.keyboard.press('Control+Alt+h')
    await page.keyboard.type('XYZ')
    await expect(async () => {
      const markText = await page
        .locator('#p-arm-word mark')
        .evaluate((el) => el.textContent)
        .catch(() => null)
      expect(markText).toContain('XYZ')
    }).toPass({ timeout: 3000 })
  })

  test('shortcut and toolbar button stay in sync (highlight active state)', async ({ page }) => {
    await waitForApp(page, `/#pg=${parityPage.id}`, { expectedText: 'parityword extra' })
    await ensureToolbarExpanded(page)

    const highlightBtn = page.getByRole('button', { name: 'Highlight', exact: true })

    // Format the word via the shortcut -> toolbar button reflects active.
    await placeCaretInParagraph(page, 'p-parity', 3)
    await page.keyboard.press('Control+Alt+h')
    await expect(highlightBtn).toHaveClass(/\bactive\b/, { timeout: 3000 })

    // Toggle off via the shortcut -> toolbar button reflects inactive.
    await placeCaretInParagraph(page, 'p-parity', 3)
    await page.keyboard.press('Control+Alt+h')
    await expect(highlightBtn).not.toHaveClass(/\bactive\b/, { timeout: 3000 })
  })
})
