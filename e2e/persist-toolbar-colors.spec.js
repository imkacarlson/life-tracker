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
// First swatch under "Standard Colors" in the shading picker (#7f1d1d).
const SHADING_MAROON_RGB = 'rgb(127, 29, 29)'

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

// A single-row, two-cell table. Cell shading is stored on the cell node's
// `backgroundColor` attribute and rendered as an inline `background-color` style.
const buildTableSeedContent = () => ({
  type: 'doc',
  content: [
    {
      type: 'table',
      attrs: { id: 'tbl-shading-1' },
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              attrs: { colspan: 1, rowspan: 1 },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shade me' }] }],
            },
            {
              type: 'tableCell',
              attrs: { colspan: 1, rowspan: 1 },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Target cell' }] }],
            },
          ],
        },
      ],
    },
  ],
})

let seedIds = {}
const seedLabel = `COLOR-PERSIST-${Date.now()}`

// Select the whole seed line so a color command has a range to mark.
const selectSeedLine = async (page) => {
  const line = page.locator('.ProseMirror p', { hasText: 'Persisted color test line' }).first()
  await expect(line).toBeVisible()
  await line.evaluate((node) => {
    const range = document.createRange()
    range.selectNodeContents(node)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    node.closest('.ProseMirror')?.focus()
  })
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

// Read the computed background color of the table cell (td/th) containing text.
const readCellColor = (page, cellText) =>
  page.evaluate((cellText) => {
    const cells = Array.from(document.querySelectorAll('.ProseMirror td, .ProseMirror th'))
    const match = cells.find((c) => (c.textContent ?? '').includes(cellText))
    return match ? getComputedStyle(match).backgroundColor : null
  }, cellText)

const pressHighlightShortcut = async (page) => {
  await page.locator('.ProseMirror').focus()
  await page.keyboard.press('Control+Alt+H')
}

test.beforeAll(async () => {
  const { client, userId } = await getSupabase()
  const notebook = await createNotebook(client, userId, `${seedLabel} Notebook`)
  const section = await createSection(client, userId, notebook.id, `${seedLabel} Section`, 0)
  const highlightPage = await createPage(
    client,
    userId,
    section.id,
    `${seedLabel} Highlight Page`,
    buildSeedContent(),
    0,
  )
  const shortcutPage = await createPage(
    client,
    userId,
    section.id,
    `${seedLabel} Shortcut Page`,
    buildSeedContent(),
    1,
  )
  const textPage = await createPage(
    client,
    userId,
    section.id,
    `${seedLabel} Text Page`,
    buildSeedContent(),
    2,
  )
  const shadingPage = await createPage(
    client,
    userId,
    section.id,
    `${seedLabel} Shading Page`,
    buildTableSeedContent(),
    3,
  )
  seedIds = { notebook, section, highlightPage, shortcutPage, textPage, shadingPage }
})

test.afterAll(async () => {
  const { client } = await getSupabase()
  await deleteNotebookById(client, seedIds.notebook?.id)
})

const seedHash = (pageRow) =>
  `#nb=${seedIds.notebook.id}&sec=${seedIds.section.id}&pg=${pageRow.id}`

test('highlight color picked via caret persists across reload and the main button applies it', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop-only: extra toolbar group is collapsed on touch')

  await waitForApp(page, seedHash(seedIds.highlightPage), { expectedText: 'Persisted color test line' })
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

  await waitForApp(page, seedHash(seedIds.shortcutPage), { expectedText: 'Persisted color test line' })
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

  // Persist the green color, then reload so storage is rehydrated from scratch.
  await page.getByRole('button', { name: 'Highlight colors' }).click()
  await page.getByRole('button', { name: 'Green', exact: true }).click()
  await page.reload()
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })
  await expect(page.locator('.ProseMirror')).toContainText('Persisted color test line')

  // The shortcut reads editor.storage.highlightColor (synced from the store).
  // Dispatch the keydown directly so CI/browser chrome never steals Ctrl+Alt+H.
  await selectSeedLine(page)
  await pressHighlightShortcut(page)

  await expect(async () => {
    expect(await readSeedColor(page, 'mark', 'backgroundColor')).toBe(HIGHLIGHT_GREEN_RGB)
  }).toPass({ timeout: 5000 })
})

test('text color picked via caret persists across reload and the main button applies it', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop-only: extra toolbar group is collapsed on touch')

  await waitForApp(page, seedHash(seedIds.textPage), { expectedText: 'Persisted color test line' })
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

test('shading color persists across reload and the main button toggles a different cell', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop-only: shading caret lives in the collapsed extra group on touch')

  await waitForApp(page, seedHash(seedIds.shadingPage), { expectedText: 'Shade me' })
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

  // Click into the first cell so the in-table shading control renders, then
  // pick a non-default color (first Standard swatch) via the caret picker.
  await page.locator('.ProseMirror td', { hasText: 'Shade me' }).first().click()
  await page.getByRole('button', { name: 'Shading colors' }).click()
  await page.getByRole('button', { name: 'Standard color 1', exact: true }).click()

  // Reload — the store must rehydrate the persisted shading color.
  await page.reload()
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })
  await expect(page.locator('.ProseMirror')).toContainText('Target cell')

  // Move the cursor to a *different, unshaded* cell. The remembered color must
  // survive this (regression: it used to be reset to null by cursor movement
  // into an unshaded cell, leaving the main button a no-op).
  await page.locator('.ProseMirror td', { hasText: 'Target cell' }).first().click()

  // The preview underbar still reflects the persisted color.
  await expect(page.locator('.shading-control .toolbar-color-bar')).toHaveCSS(
    'background-color',
    SHADING_MAROON_RGB,
  )

  // Clicking the main button (not the dropdown) shades the current cell with
  // the remembered color.
  await page.getByRole('button', { name: 'Cell shading', exact: true }).click()

  await expect(async () => {
    expect(await readCellColor(page, 'Target cell')).toBe(SHADING_MAROON_RGB)
  }).toPass({ timeout: 5000 })

  // Clicking the main button again while the current cell is shaded clears it
  // back to the table's default background without forgetting the swatch color.
  await page.getByRole('button', { name: 'Cell shading', exact: true }).click()

  await expect(async () => {
    expect(await readCellColor(page, 'Target cell')).toBe('rgba(0, 0, 0, 0)')
  }).toPass({ timeout: 5000 })

  await expect(page.locator('.shading-control .toolbar-color-bar')).toHaveCSS(
    'background-color',
    SHADING_MAROON_RGB,
  )
})
