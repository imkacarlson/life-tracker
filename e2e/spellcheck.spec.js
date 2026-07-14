/**
 * E2E coverage for the in-app spell checker routed into the right-click menu.
 *
 * Desktop flows:
 *   1. A misspelled word gets a `.spellcheck-error` underline; right-clicking it
 *      shows suggestions in the custom menu; clicking one corrects the word.
 *   2. "Add to dictionary" clears the squiggle and persists — after a reload the
 *      custom word is still not flagged.
 *   3. A misspelling buried deep in a tall (taller-than-viewport) document is
 *      flagged without scrolling — regression coverage for the full-document
 *      scan replacing the old, unreliable viewport-only scan.
 *
 * Mobile flow:
 *   The feature is desktop-only. On the Mobile Chrome project nothing is
 *   underlined and the dictionary asset is never requested (keeps phones light
 *   on bad cell service).
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

// Coined name that will never be in the dictionary — used for the add-to-dictionary flow.
const CUSTOM_WORD = 'Kacarlsonia'

// Coined word placed deep in the tall page. Distinctive so the locator can find
// exactly one squiggle; never a real word, so it is always flagged.
const DEEP_TYPO = 'Zblorptastic'

// A sentence of only common, correctly-spelled English words, so the tall page's
// filler never produces incidental squiggles that could confuse assertions.
const FILLER_SENTENCE =
  'This is a normal line of tracker notes with plenty of everyday words that the checker should not flag as wrong.'

// Build a document far taller than the viewport — like a real month-long tracker —
// with the sentinel misspelling buried well below the fold. The old viewport-only
// scan never reached content this deep (and on this app's window-scroll layout
// collapsed to nothing entirely); the full-document scan flags it immediately.
const buildTallTrackerContent = () => {
  const content = [
    {
      type: 'paragraph',
      attrs: { id: 'tall-title' },
      content: [{ type: 'text', text: 'Marathon training and life admin tracker' }],
    },
  ]
  for (let i = 0; i < 60; i += 1) {
    content.push({
      type: 'paragraph',
      attrs: { id: `tall-fill-${i}` },
      content: [{ type: 'text', text: `${i + 1}. ${FILLER_SENTENCE}` }],
    })
  }
  content.push({
    type: 'paragraph',
    attrs: { id: 'tall-deep-typo' },
    content: [{ type: 'text', text: `Remember to call the ${DEEP_TYPO} about the thing.` }],
  })
  for (let i = 0; i < 5; i += 1) {
    content.push({
      type: 'paragraph',
      attrs: { id: `tall-tail-${i}` },
      content: [{ type: 'text', text: FILLER_SENTENCE }],
    })
  }
  return { type: 'doc', content }
}

const buildSuggestContent = () => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id: 'p-spell-suggest' },
      content: [{ type: 'text', text: 'teh quikc fox' }],
    },
  ],
})

const buildCustomWordContent = () => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id: 'p-spell-custom' },
      // Keep a second known typo so the post-reload assertion can prove the
      // scanner has completed without spending 15 seconds in a swallowed wait.
      content: [{ type: 'text', text: `${CUSTOM_WORD} runs daily with teh` }],
    },
  ],
})

let seedIds = {}
const seedLabel = `SPELL-${Date.now()}`

test.beforeAll(async () => {
  const { client, userId } = await getSupabase()
  const notebook = await createNotebook(client, userId, `${seedLabel} Notebook`)
  const section = await createSection(client, userId, notebook.id, `${seedLabel} Section`, 0)
  const suggestPage = await createPage(
    client,
    userId,
    section.id,
    `${seedLabel} Suggest Page`,
    buildSuggestContent(),
    0,
  )
  const customPage = await createPage(
    client,
    userId,
    section.id,
    `${seedLabel} Custom Page`,
    buildCustomWordContent(),
    1,
  )
  const tallPage = await createPage(
    client,
    userId,
    section.id,
    `${seedLabel} Tall Page`,
    buildTallTrackerContent(),
    2,
  )
  seedIds = { notebook, section, suggestPage, customPage, tallPage }
})

test.afterAll(async () => {
  const { client, userId } = await getSupabase()
  // custom_dictionary isn't covered by the isolation snapshot — clean the word we added.
  await client.from('custom_dictionary').delete().eq('user_id', userId).eq('word', CUSTOM_WORD)
  await deleteNotebookById(client, seedIds.notebook?.id)
})

const seedHash = (pageRow) =>
  `#nb=${seedIds.notebook.id}&sec=${seedIds.section.id}&pg=${pageRow.id}`

test('right-click on a misspelling shows suggestions and corrects the word @desktop', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop-only: in-app spell check is gated off on touch devices')

  await waitForApp(page, seedHash(seedIds.suggestPage), { expectedText: 'fox' })
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

  // The dictionary loads lazily, then a debounced scan underlines "teh".
  const tehError = page.locator('.spellcheck-error', { hasText: 'teh' })
  await expect(tehError).toBeVisible({ timeout: 15000 })

  // Right-click the flagged word → custom menu with a suggestions section.
  await tehError.click({ button: 'right' })
  const menu = page.locator('.table-context-menu')
  await expect(menu).toBeVisible()
  const suggestions = menu.locator('.spellcheck-suggestion')
  await expect(suggestions.first()).toBeVisible()

  // Clicking a suggestion replaces the word and clears its squiggle.
  const chosen = (await suggestions.first().textContent())?.trim()
  expect(chosen && chosen.length > 0).toBe(true)
  await suggestions.first().click()

  await expect(page.locator('.ProseMirror')).toContainText(chosen)
  await expect(page.locator('.spellcheck-error', { hasText: 'teh' })).toHaveCount(0)
})

test('"Add to dictionary" clears the squiggle and persists across reloads @desktop', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop-only: in-app spell check is gated off on touch devices')

  await waitForApp(page, seedHash(seedIds.customPage), { expectedText: CUSTOM_WORD })
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

  const customError = page.locator('.spellcheck-error', { hasText: CUSTOM_WORD })
  await expect(customError).toBeVisible({ timeout: 15000 })

  await customError.click({ button: 'right' })
  const menu = page.locator('.table-context-menu')
  await expect(menu).toBeVisible()
  await menu.getByRole('button', { name: 'Add to dictionary' }).click()

  // Squiggle clears immediately (in-memory nspell.add + re-scan).
  await expect(page.locator('.spellcheck-error', { hasText: CUSTOM_WORD })).toHaveCount(0)

  // Persisted: reload, and the word is loaded back into the checker on mount,
  // so it never gets flagged again.
  await waitForApp(page, seedHash(seedIds.customPage), { expectedText: CUSTOM_WORD })
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })
  // Wait for a separate known typo to prove lazy dictionary loading and the
  // debounced scan completed, then verify the persisted custom word stays clear.
  await expect(page.locator('.spellcheck-error', { hasText: 'teh' })).toBeVisible({
    timeout: 15000,
  })
  await expect(page.locator('.spellcheck-error', { hasText: CUSTOM_WORD })).toHaveCount(0)
})

test('flags a misspelling deep in a tall document without scrolling @desktop', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop-only: in-app spell check is gated off on touch devices')

  await waitForApp(page, seedHash(seedIds.tallPage), { expectedText: 'Marathon training' })
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

  // The sentinel typo sits ~60 paragraphs down, far below the initial viewport.
  // A viewport-only scan would miss it (this is the regression the full-document
  // scan fixes); assert it is flagged with no scrolling at all.
  const deepError = page.locator('.spellcheck-error', { hasText: DEEP_TYPO })
  await expect(deepError).toHaveCount(1, { timeout: 15000 })

  // Confirm it really was below the fold — proving the whole document was scanned,
  // not just what happened to be on screen.
  const box = await deepError.boundingBox()
  const viewportHeight = page.viewportSize()?.height ?? 0
  expect(box).not.toBeNull()
  expect(box.y).toBeGreaterThan(viewportHeight)
})

test('right-click resolves the misspelling under the cursor on a tall page @desktop', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop-only: in-app spell check is gated off on touch devices')

  await waitForApp(page, seedHash(seedIds.tallPage), { expectedText: 'Marathon training' })
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

  const deepError = page.locator('.spellcheck-error', { hasText: DEEP_TYPO })
  await expect(deepError).toHaveCount(1, { timeout: 15000 })

  // Right-clicking the deep word must open the menu WITH its spelling section.
  // The menu resolves the word from the clicked element (not coordinate probing),
  // so it works even though the word is far below the initial viewport.
  await deepError.click({ button: 'right' })
  const menu = page.locator('.table-context-menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('button', { name: 'Add to dictionary' })).toBeVisible()
})

test('mobile never underlines and never fetches the dictionary @mobile', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile-only assertion: feature must stay off on touch devices')

  const dictionaryRequests = []
  page.on('request', (request) => {
    if (request.url().includes('/dictionaries/')) {
      dictionaryRequests.push(request.url())
    }
  })

  await waitForApp(page, seedHash(seedIds.suggestPage), { expectedText: 'fox' })
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

  // Wait out the desktop debounce window so a stray scan would have happened.
  await page.waitForTimeout(2000)

  await expect(page.locator('.spellcheck-error')).toHaveCount(0)
  expect(dictionaryRequests).toEqual([])
})
