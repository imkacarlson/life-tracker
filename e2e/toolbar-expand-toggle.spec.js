/**
 * E2E regression tests for the mobile toolbar expand/collapse toggle.
 *
 * Bug we are guarding against: ToolButton used to attach a non-passive,
 * capture-phase `touchstart` listener that called `preventDefault()`. On
 * Android Chrome, canceling touchstart suppresses the synthetic `click`
 * that would otherwise follow touchend — so the expand toggle (and every
 * other tool button) intermittently never received its click on real
 * devices. The toolbar would get stuck open or refuse to expand at all.
 *
 * These tests run only against the Mobile Chrome project, which exercises
 * the touch event path. Playwright's `.tap()` dispatches the full
 * touchstart → touchend → mousedown → click sequence, matching real
 * device behavior closely enough to catch the regression.
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

const buildSeedContent = () => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id: 'p-toggle-1' },
      content: [{ type: 'text', text: 'Toolbar toggle test line one' }],
    },
    {
      type: 'paragraph',
      attrs: { id: 'p-toggle-2' },
      content: [{ type: 'text', text: 'Toolbar toggle test line two' }],
    },
  ],
})

let seedIds = {}
const seedLabel = `TB-TOGGLE-${Date.now()}`

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

test(
  'mobile expand toggle flips state on a single tap',
  async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Mobile-only test')

    const hash = `#nb=${seedIds.notebook.id}&sec=${seedIds.section.id}&pg=${seedIds.page.id}`
    await waitForApp(page, hash, { expectedText: 'Toolbar toggle test line one' })

    const expandToggle = page.getByTestId('toolbar-expand-toggle')
    await expect(expandToggle).toBeVisible()

    // Starts collapsed on touch devices.
    await expect(expandToggle).toHaveAttribute('aria-label', 'Expand toolbar')
    await expect(page.locator('.toolbar')).toHaveClass(/toolbar-collapsed/)

    // One tap should flip the state.
    await expandToggle.tap()
    await expect(expandToggle).toHaveAttribute('aria-label', 'Collapse toolbar')
    await expect(page.locator('.toolbar')).not.toHaveClass(/toolbar-collapsed/)

    // Tapping again should flip back — this was the "stuck open" case.
    await expandToggle.tap()
    await expect(expandToggle).toHaveAttribute('aria-label', 'Expand toolbar')
    await expect(page.locator('.toolbar')).toHaveClass(/toolbar-collapsed/)
  },
)

test(
  'tapping a command button preserves editor selection and applies the command',
  async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Mobile-only test')

    const hash = `#nb=${seedIds.notebook.id}&sec=${seedIds.section.id}&pg=${seedIds.page.id}`
    await waitForApp(page, hash, { expectedText: 'Toolbar toggle test line one' })

    // Place cursor inside the first paragraph and select the word "toggle".
    const firstPara = page.locator('#p-toggle-1')
    await firstPara.click()
    await page.waitForTimeout(100)

    // Select a word programmatically through Tiptap; tapping the toolbar
    // button must not collapse this selection.
    await page.evaluate(() => {
      const para = document.querySelector('#p-toggle-1')
      if (!para) return
      const text = para.firstChild
      if (!text) return
      const start = para.textContent.indexOf('toggle')
      const end = start + 'toggle'.length
      const range = document.createRange()
      range.setStart(text, start)
      range.setEnd(text, end)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
    })

    const selectionBefore = await page.evaluate(() => window.getSelection()?.toString())
    expect(selectionBefore).toBe('toggle')

    // Tap the Bold button (in toolbar-core, always visible on touch).
    const boldButton = page.getByRole('button', { name: 'Bold' })
    await boldButton.tap()

    // The bold command should have applied — the selected word is now wrapped.
    await expect(page.locator('#p-toggle-1 strong')).toHaveText('toggle')

    // And the editor should still hold the same selection (didn't collapse).
    const selectionAfter = await page.evaluate(() => window.getSelection()?.toString())
    expect(selectionAfter).toBe('toggle')
  },
)
