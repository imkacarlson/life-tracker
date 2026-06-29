/**
 * E2E regression test for clean highlight toggling on the word under a
 * collapsed caret.
 *
 * Bug: clicking the highlight button with a collapsed caret used to
 * `setTextSelection(range)` first, selecting the whole word. The native blue
 * text selection then sat on top of the highlight, hiding the color, and the
 * cursor was visibly disturbed. The fix stamps the mark onto the computed word
 * range via a ProseMirror transaction, never touching the visible selection.
 *
 * These flows place a collapsed caret inside a word and assert:
 *   1. Clicking Highlight wraps the word in a <mark> with the expected color
 *      AND leaves the selection collapsed/empty (no leftover blue overlay).
 *   2. Clicking Highlight again removes the mark.
 *   3. Picking a specific color from the dropdown with a collapsed caret
 *      highlights the word with that color and keeps the selection collapsed.
 *
 * The dropdown picker lives in the collapsed "extra" toolbar group on touch
 * devices, so these run desktop-only (matching persist-toolbar-colors.spec.js).
 */

import { test, expect } from './fixtures'
import {
  getSupabase,
  createNotebook,
  createSection,
  createPage,
  deleteNotebookById,
  waitForApp,
} from './test-helpers'

const HIGHLIGHT_YELLOW_RGB = 'rgb(254, 240, 138)' // default color (#fef08a)
const HIGHLIGHT_GREEN_RGB = 'rgb(134, 239, 172)' // picked color (#86efac)

const SEED_WORD = 'Background'

const buildSeedContent = () => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id: 'p-hl-cursor-1' },
      content: [{ type: 'text', text: `${SEED_WORD} notes line` }],
    },
  ],
})

let seedIds = {}
const seedLabel = `HL-CURSOR-${Date.now()}`

// Place a COLLAPSED caret in the middle of the seed word — no selection.
const placeCaretInWord = async (page) => {
  const line = page.locator('.ProseMirror p', { hasText: SEED_WORD }).first()
  await expect(line).toBeVisible()
  await line.evaluate((node, word) => {
    // Find the text node and a character offset inside the target word.
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    let textNode = walker.nextNode()
    while (textNode && !(textNode.textContent ?? '').includes(word)) {
      textNode = walker.nextNode()
    }
    if (!textNode) throw new Error(`Could not find text node containing "${word}"`)
    const idx = (textNode.textContent ?? '').indexOf(word)
    const caretAt = idx + Math.floor(word.length / 2)
    const range = document.createRange()
    range.setStart(textNode, caretAt)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    node.closest('.ProseMirror')?.focus()
  }, SEED_WORD)
}

// Read the inline background color of the <mark> wrapping the seed word, or null.
const readWordMarkColor = (page) =>
  page.evaluate((word) => {
    const marks = Array.from(document.querySelectorAll('.ProseMirror mark'))
    const match = marks.find((m) => (m.textContent ?? '').includes(word))
    return match ? getComputedStyle(match).backgroundColor : null
  }, SEED_WORD)

// True when the native selection is collapsed with no selected text.
const selectionIsCollapsed = (page) =>
  page.evaluate(() => {
    const selection = window.getSelection()
    return Boolean(selection?.isCollapsed) && (selection?.toString() ?? '') === ''
  })

test.beforeAll(async () => {
  const { client, userId } = await getSupabase()
  const notebook = await createNotebook(client, userId, `${seedLabel} Notebook`)
  const section = await createSection(client, userId, notebook.id, `${seedLabel} Section`, 0)
  const togglePage = await createPage(
    client,
    userId,
    section.id,
    `${seedLabel} Toggle Page`,
    buildSeedContent(),
    0,
  )
  const pickPage = await createPage(
    client,
    userId,
    section.id,
    `${seedLabel} Pick Page`,
    buildSeedContent(),
    1,
  )
  seedIds = { notebook, section, togglePage, pickPage }
})

test.afterAll(async () => {
  const { client } = await getSupabase()
  await deleteNotebookById(client, seedIds.notebook?.id)
})

const seedHash = (pageRow) =>
  `#nb=${seedIds.notebook.id}&sec=${seedIds.section.id}&pg=${pageRow.id}`

test('Highlight on a collapsed caret marks the whole word without disturbing the selection', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop-only: relies on a collapsed-caret highlight flow')

  await waitForApp(page, seedHash(seedIds.togglePage), { expectedText: SEED_WORD })
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

  // Caret inside the word, nothing selected, then click the main Highlight button.
  await placeCaretInWord(page)
  await page.getByRole('button', { name: 'Highlight', exact: true }).click()

  // The whole word is wrapped in a <mark> with the default (yellow) color...
  await expect(async () => {
    expect(await readWordMarkColor(page)).toBe(HIGHLIGHT_YELLOW_RGB)
  }).toPass({ timeout: 5000 })

  // ...and the selection stays collapsed — no leftover native blue overlay.
  expect(await selectionIsCollapsed(page)).toBe(true)

  // Clicking Highlight again removes the mark.
  await placeCaretInWord(page)
  await page.getByRole('button', { name: 'Highlight', exact: true }).click()

  await expect(async () => {
    expect(await readWordMarkColor(page)).toBe(null)
  }).toPass({ timeout: 5000 })
})

test('Picking a dropdown color with a collapsed caret highlights the word and keeps it collapsed', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop-only: dropdown picker lives in the collapsed extra group on touch')

  await waitForApp(page, seedHash(seedIds.pickPage), { expectedText: SEED_WORD })
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

  // Caret inside the word, then pick Green from the highlight dropdown.
  await placeCaretInWord(page)
  await page.getByRole('button', { name: 'Highlight colors' }).click()
  await page.getByRole('button', { name: 'Green', exact: true }).click()

  // The word gets the picked color...
  await expect(async () => {
    expect(await readWordMarkColor(page)).toBe(HIGHLIGHT_GREEN_RGB)
  }).toPass({ timeout: 5000 })

  // ...and the selection remains collapsed.
  expect(await selectionIsCollapsed(page)).toBe(true)
})
