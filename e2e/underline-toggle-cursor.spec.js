/**
 * E2E regression test for word-level cursor formatting on Bold, Italic,
 * Underline, and Text color — the same UX as Highlight
 * (see highlight-toggle-cursor.spec.js).
 *
 * With a COLLAPSED caret inside a word (nothing selected), clicking each of
 * these buttons formats the WHOLE word under the caret via a ProseMirror
 * transaction, never touching the visible selection. So:
 *   1. The whole word gets the mark (e.g. wrapped in <u>/<strong>/<em>, or the
 *      <span style="color: …"> for text color).
 *   2. The selection stays collapsed/empty (no leftover native blue overlay).
 *   3. Clicking the same button again removes the mark.
 *
 * The text-color dropdown picker lives in the collapsed "extra" toolbar group on
 * touch devices, so these run desktop-only (matching the highlight spec).
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

const TEXT_BLUE_RGB = 'rgb(37, 99, 235)' // picked text color (#2563eb)

const SEED_WORD = 'Background'

const buildSeedContent = (id) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id },
      content: [{ type: 'text', text: `${SEED_WORD} notes line` }],
    },
  ],
})

let seedIds = {}
const seedLabel = `MARK-CURSOR-${Date.now()}`

// Place a COLLAPSED caret in the middle of the seed word — no selection.
const placeCaretInWord = async (page) => {
  const line = page.locator('.ProseMirror p', { hasText: SEED_WORD }).first()
  await expect(line).toBeVisible()
  await line.evaluate((node, word) => {
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

// True when the seed word is fully wrapped by an element matching `selector`.
const wordHasWrapper = (page, selector) =>
  page.evaluate(
    ({ word, sel }) => {
      const els = Array.from(document.querySelectorAll(`.ProseMirror ${sel}`))
      return els.some((el) => (el.textContent ?? '').includes(word))
    },
    { word: SEED_WORD, sel: selector },
  )

// Read the inline text color of the <span> wrapping the seed word, or null.
const readWordTextColor = (page) =>
  page.evaluate((word) => {
    const spans = Array.from(document.querySelectorAll('.ProseMirror span[style*="color"]'))
    const match = spans.find((s) => (s.textContent ?? '').includes(word))
    return match ? getComputedStyle(match).color : null
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
  const boldPage = await createPage(
    client, userId, section.id, `${seedLabel} Bold Page`, buildSeedContent('p-bold-1'), 0,
  )
  const italicPage = await createPage(
    client, userId, section.id, `${seedLabel} Italic Page`, buildSeedContent('p-italic-1'), 1,
  )
  const underlinePage = await createPage(
    client, userId, section.id, `${seedLabel} Underline Page`, buildSeedContent('p-underline-1'), 2,
  )
  const colorPage = await createPage(
    client, userId, section.id, `${seedLabel} Color Page`, buildSeedContent('p-color-1'), 3,
  )
  seedIds = { notebook, section, boldPage, italicPage, underlinePage, colorPage }
})

test.afterAll(async () => {
  const { client } = await getSupabase()
  await deleteNotebookById(client, seedIds.notebook?.id)
})

const seedHash = (pageRow) =>
  `#nb=${seedIds.notebook.id}&sec=${seedIds.section.id}&pg=${pageRow.id}`

// Shared flow for a simple boolean inline mark (bold/italic/underline): the whole
// word gets wrapped on click, the selection stays collapsed, and a second click
// removes the wrapper.
const runInlineMarkToggle = async ({ page, pageRow, buttonName, wrapperSelector }) => {
  await waitForApp(page, seedHash(pageRow), { expectedText: SEED_WORD })
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

  await placeCaretInWord(page)
  await page.getByRole('button', { name: buttonName, exact: true }).click()

  await expect(async () => {
    expect(await wordHasWrapper(page, wrapperSelector)).toBe(true)
  }).toPass({ timeout: 5000 })

  expect(await selectionIsCollapsed(page)).toBe(true)

  await placeCaretInWord(page)
  await page.getByRole('button', { name: buttonName, exact: true }).click()

  await expect(async () => {
    expect(await wordHasWrapper(page, wrapperSelector)).toBe(false)
  }).toPass({ timeout: 5000 })
}

test('Underline on a collapsed caret marks the whole word without disturbing the selection', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop-only: relies on a collapsed-caret word-format flow')
  await runInlineMarkToggle({
    page,
    pageRow: seedIds.underlinePage,
    buttonName: 'Underline',
    wrapperSelector: 'u',
  })
})

test('Bold on a collapsed caret marks the whole word and toggles off', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop-only: relies on a collapsed-caret word-format flow')
  await runInlineMarkToggle({
    page,
    pageRow: seedIds.boldPage,
    buttonName: 'Bold',
    wrapperSelector: 'strong',
  })
})

test('Italic on a collapsed caret marks the whole word and toggles off', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop-only: relies on a collapsed-caret word-format flow')
  await runInlineMarkToggle({
    page,
    pageRow: seedIds.italicPage,
    buttonName: 'Italic',
    wrapperSelector: 'em',
  })
})

test('Picking a text color with a collapsed caret colors the whole word and keeps it collapsed', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop-only: dropdown picker lives in the collapsed extra group on touch')

  await waitForApp(page, seedHash(seedIds.colorPage), { expectedText: SEED_WORD })
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

  await placeCaretInWord(page)
  await page.getByRole('button', { name: 'Text colors' }).click()
  await page.getByRole('button', { name: 'Blue', exact: true }).click()

  await expect(async () => {
    expect(await readWordTextColor(page)).toBe(TEXT_BLUE_RGB)
  }).toPass({ timeout: 5000 })

  expect(await selectionIsCollapsed(page)).toBe(true)
})
