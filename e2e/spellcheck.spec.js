/**
 * E2E coverage for the in-app spell checker routed into the right-click menu.
 *
 * Desktop flows:
 *   1. A misspelled word gets a `.spellcheck-error` underline; right-clicking it
 *      shows suggestions in the custom menu; clicking one corrects the word.
 *   2. "Add to dictionary" clears the squiggle and persists — after a reload the
 *      custom word is still not flagged.
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
      content: [{ type: 'text', text: `${CUSTOM_WORD} runs daily` }],
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
  seedIds = { notebook, section, suggestPage, customPage }
})

test.afterAll(async () => {
  const { client, userId } = await getSupabase()
  // custom_dictionary isn't covered by the isolation snapshot — clean the word we added.
  await client.from('custom_dictionary').delete().eq('user_id', userId).eq('word', CUSTOM_WORD)
  await deleteNotebookById(client, seedIds.notebook?.id)
})

const seedHash = (pageRow) =>
  `#nb=${seedIds.notebook.id}&sec=${seedIds.section.id}&pg=${pageRow.id}`

test('right-click on a misspelling shows suggestions and corrects the word', async ({
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

test('"Add to dictionary" clears the squiggle and persists across reloads', async ({
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
  // Give the lazy load + a debounced scan time to run, then assert no squiggle.
  await expect(page.locator('.spellcheck-error', { hasText: 'runs' })).toBeVisible({
    timeout: 15000,
  }).catch(() => {})
  await expect(page.locator('.spellcheck-error', { hasText: CUSTOM_WORD })).toHaveCount(0)
})

test('mobile never underlines and never fetches the dictionary', async ({ page, isMobile }) => {
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
