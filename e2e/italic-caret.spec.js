/**
 * E2E regression test for the custom slanted (italic) caret.
 *
 * No browser slants the native text caret for italic text, so an ItalicCaret
 * extension draws its own skewed caret element (`.italic-caret`) and hides the
 * native one — but ONLY while italic is active on a collapsed caret. This test
 * asserts the behavioral contract:
 *   1. Caret inside italic text → a `.italic-caret` element is shown, skewed.
 *   2. Caret in plain text → no custom caret (native caret used).
 *   3. Arming italic on an empty spot (the original complaint) → caret appears.
 *   4. A range selection → no stray custom caret.
 *
 * Runs on the Desktop Chrome project; the mechanic is desktop+mobile but the
 * on-screen-keyboard interaction is verified on-device, not in emulation.
 */

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

const ITALIC_WORD = 'Slanted'
const PLAIN_WORD = 'Upright'

const buildSeedContent = () => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id: 'p-italic-existing' },
      content: [{ type: 'text', marks: [{ type: 'italic' }], text: `${ITALIC_WORD} italic line` }],
    },
    {
      type: 'paragraph',
      attrs: { id: 'p-plain-existing' },
      content: [{ type: 'text', text: `${PLAIN_WORD} plain line` }],
    },
    {
      type: 'paragraph',
      attrs: { id: 'p-empty-arm' },
    },
  ],
})

let seedIds = {}
const seedLabel = `ITALIC-CARET-${Date.now()}`

const placeCaretInWord = async (page, word) => {
  const line = page.locator('.ProseMirror p', { hasText: word }).first()
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
  }, word)
}

const placeCaretInEmptyParagraph = async (page, paragraphId) => {
  await page.locator(`#${paragraphId}`).evaluate((paragraph) => {
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    paragraph.closest('.ProseMirror')?.focus()
  })
}

const selectWord = async (page, word) => {
  const line = page.locator('.ProseMirror p', { hasText: word }).first()
  await line.evaluate((node, word) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    let textNode = walker.nextNode()
    while (textNode && !(textNode.textContent ?? '').includes(word)) {
      textNode = walker.nextNode()
    }
    if (!textNode) throw new Error(`Could not find text node containing "${word}"`)
    const idx = (textNode.textContent ?? '').indexOf(word)
    const range = document.createRange()
    range.setStart(textNode, idx)
    range.setEnd(textNode, idx + word.length)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    node.closest('.ProseMirror')?.focus()
  }, word)
}

// The custom caret lives on document.body; it is present but display:none when
// inactive. Report whether it is actually shown, and its computed transform.
const readCaretState = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.italic-caret')
    if (!el) return { present: false, shown: false, transform: null }
    const style = getComputedStyle(el)
    return {
      present: true,
      shown: style.display !== 'none',
      transform: style.transform,
    }
  })

test.beforeAll(async () => {
  const { client, userId } = await getSupabase()
  const notebook = await createNotebook(client, userId, `${seedLabel} Notebook`)
  const section = await createSection(client, userId, notebook.id, `${seedLabel} Section`, 0)
  const page = await createPage(
    client, userId, section.id, `${seedLabel} Page`, buildSeedContent(), 0,
  )
  seedIds = { notebook, section, page }
})

test.afterAll(async () => {
  const { client } = await getSupabase()
  await deleteNotebookById(client, seedIds.notebook?.id)
})

const seedHash = () =>
  `#nb=${seedIds.notebook.id}&sec=${seedIds.section.id}&pg=${seedIds.page.id}`

test('shows a slanted caret in italic text, hides it in plain text @desktop', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop project owns the caret assertion; on-device covers touch/keyboard')

  await waitForApp(page, seedHash(), { expectedText: ITALIC_WORD })
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

  // (1) Caret inside existing italic text → custom caret shown and skewed.
  await placeCaretInWord(page, ITALIC_WORD)
  await expect(async () => {
    const state = await readCaretState(page)
    expect(state.shown).toBe(true)
    // A real skewX renders as a non-identity matrix (not 'none', not identity).
    expect(state.transform).toContain('matrix')
    expect(state.transform).not.toBe('matrix(1, 0, 0, 1, 0, 0)')
  }).toPass({ timeout: 5000 })

  // (2) Caret in plain text → custom caret hidden (native caret used).
  await placeCaretInWord(page, PLAIN_WORD)
  await expect(async () => {
    expect((await readCaretState(page)).shown).toBe(false)
  }).toPass({ timeout: 5000 })
})

test('arming italic on an empty spot shows the slanted caret immediately @desktop', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop project owns the caret assertion; on-device covers touch/keyboard')

  await waitForApp(page, seedHash(), { expectedText: ITALIC_WORD })
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

  await placeCaretInEmptyParagraph(page, 'p-empty-arm')
  // Native caret before arming italic — no custom caret yet.
  await expect(async () => {
    expect((await readCaretState(page)).shown).toBe(false)
  }).toPass({ timeout: 5000 })

  await ensureToolbarExpanded(page)
  await page.getByRole('button', { name: 'Italic', exact: true }).click()

  // The exact original complaint: caret should go slanted with nothing typed.
  await expect(async () => {
    const state = await readCaretState(page)
    expect(state.shown).toBe(true)
    expect(state.transform).toContain('matrix')
  }).toPass({ timeout: 5000 })
})

test('no stray custom caret during a range selection @desktop', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop project owns the caret assertion; on-device covers touch/keyboard')

  await waitForApp(page, seedHash(), { expectedText: ITALIC_WORD })
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

  // Select a range of italic text — the native selection UI owns this, so the
  // custom (collapsed-only) caret must not appear.
  await selectWord(page, ITALIC_WORD)
  await expect(async () => {
    expect((await readCaretState(page)).shown).toBe(false)
  }).toPass({ timeout: 5000 })
})
