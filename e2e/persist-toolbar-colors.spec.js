/**
 * E2E regression tests for persisted toolbar color tools.
 *
 * Guards three behaviors introduced when highlight/text-color/cell-shading
 * gained localStorage persistence + a uniform split-button pattern:
 *   1. A highlight color picked via the caret survives a reload — the preview
 *      underbar shows it and the main button applies it.
 *   2. The Ctrl+Alt+H shortcut applies the persisted color after reload
 *      (it reads editor.storage.highlightColor, synced from the store).
 *   3. The text-color split button persists its color across reload and the
 *      main button applies it.
 *
 * Picker-based tools live in the toolbar "extra" group, which is collapsed on
 * touch devices, and these flows rely on a desktop keyboard selection — so the
 * specs run desktop-only. Mobile persistence is covered by the manual pass.
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

const HIGHLIGHT_GREEN_RGB = 'rgb(134, 239, 172)'
const TEXT_BLUE_RGB = 'rgb(37, 99, 235)'

const buildSeedContent = () => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id: 'p-color-1' },
      content: [{ type: 'text', text: 'Persisted color test line' }],
    },
  ],
})

let seedIds = {}
const seedLabel = `COLOR-PERSIST-${Date.now()}`

// Select the whole seed line so a color command has a range to mark.
const selectSeedLine = async (page) => {
  const line = page.locator('.ProseMirror p', { hasText: 'Persisted color test line' }).first()
  await line.click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
}

// Read the inline color applied to the seed text, scoped to mark/span tags.
const readSeedColor = (page, tag, prop) =>
  page.evaluate(
    ({ tag, prop }) => {
      const nodes = Array.from(document.querySelectorAll(`.ProseMirror ${tag}`))
      const match = nodes.find((n) => (n.textContent ?? '').includes('Persisted color test line'))
      return match ? getComputedStyle(match)[prop] : null
    },
    { tag, prop },
  )

test.beforeAll(async () => {
  const { client, userId } = await getSupabase()
  const notebook = await createNotebook(client, userId, `${seedLabel} Notebook`)
  const section = await createSection(client, userId, notebook.id, `${seedLabel} Section`, 0)
  const page = await createPage(
    client,
    userId,
    section.id,
    `${seedLabel} Page`,
    buildSeedContent(),
    0,
  )
  seedIds = { notebook, section, page }
})

test.afterAll(async () => {
  const { client } = await getSupabase()
  await deleteNotebookById(client, seedIds.notebook?.id)
})

const seedHash = () =>
  `#nb=${seedIds.notebook.id}&sec=${seedIds.section.id}&pg=${seedIds.page.id}`

test('highlight color picked via caret persists across reload and the main button applies it', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop-only: extra toolbar group is collapsed on touch')

  await waitForApp(page, seedHash(), { expectedText: 'Persisted color test line' })
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

  // Pick a non-default highlight color (Green) via the caret picker.
  await page.getByRole('button', { name: 'Highlight colors' }).click()
  await page.getByRole('button', { name: 'Green', exact: true }).click()

  // Reload — the store must rehydrate the persisted color from localStorage.
  await page.reload()
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })
  await expect(page.locator('.ProseMirror')).toContainText('Persisted color test line')

  // The preview underbar reflects the persisted color.
  await expect(page.locator('.highlight-control .toolbar-color-bar')).toHaveCSS(
    'background-color',
    HIGHLIGHT_GREEN_RGB,
  )

  // Clicking the main button applies the persisted color to the selection.
  await selectSeedLine(page)
  await page.getByRole('button', { name: 'Highlight', exact: true }).click()

  await expect(async () => {
    expect(await readSeedColor(page, 'mark', 'backgroundColor')).toBe(HIGHLIGHT_GREEN_RGB)
  }).toPass({ timeout: 5000 })
})

test('Ctrl+Alt+H applies the persisted highlight color after reload', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop keyboard shortcut flow')

  await waitForApp(page, seedHash(), { expectedText: 'Persisted color test line' })
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

  // Persist the green color, then reload so storage is rehydrated from scratch.
  await page.getByRole('button', { name: 'Highlight colors' }).click()
  await page.getByRole('button', { name: 'Green', exact: true }).click()
  await page.reload()
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })
  await expect(page.locator('.ProseMirror')).toContainText('Persisted color test line')

  // The shortcut reads editor.storage.highlightColor (synced from the store).
  await selectSeedLine(page)
  await page.keyboard.press('Control+Alt+h')

  await expect(async () => {
    expect(await readSeedColor(page, 'mark', 'backgroundColor')).toBe(HIGHLIGHT_GREEN_RGB)
  }).toPass({ timeout: 5000 })
})

test('text color picked via caret persists across reload and the main button applies it', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop-only: extra toolbar group is collapsed on touch')

  await waitForApp(page, seedHash(), { expectedText: 'Persisted color test line' })
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

  // Pick a text color (Blue) via the caret picker.
  await page.getByRole('button', { name: 'Text colors' }).click()
  await page.getByRole('button', { name: 'Blue', exact: true }).click()

  await page.reload()
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })
  await expect(page.locator('.ProseMirror')).toContainText('Persisted color test line')

  // The preview underbar reflects the persisted color.
  await expect(page.locator('.text-color-control .toolbar-color-bar')).toHaveCSS(
    'background-color',
    TEXT_BLUE_RGB,
  )

  // Clicking the main button applies the persisted color to the selection.
  await selectSeedLine(page)
  await page.getByRole('button', { name: 'Text color', exact: true }).click()

  await expect(async () => {
    expect(await readSeedColor(page, 'span', 'color')).toBe(TEXT_BLUE_RGB)
  }).toPass({ timeout: 5000 })
})
