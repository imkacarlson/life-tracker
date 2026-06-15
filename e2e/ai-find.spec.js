import { test, expect } from './fixtures'
import {
  getSupabase,
  createNotebook,
  createSection,
  createPage,
  deleteNotebookById,
  waitForApp,
} from './test-helpers'

// Self-contained seed: a page with several bullet points whose ids are known,
// so the route stub can return deterministic matchIds.
const SEED_CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'bulletList',
      attrs: { id: 'aifind-ul' },
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              attrs: { id: 'aifind-jerry' },
              content: [{ type: 'text', text: 'Send Jerry a weekly update' }],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              attrs: { id: 'aifind-rent' },
              content: [{ type: 'text', text: 'Pay rent before the first' }],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              attrs: { id: 'aifind-call' },
              content: [{ type: 'text', text: 'Call the dentist to reschedule' }],
            },
          ],
        },
      ],
    },
  ],
}

test.describe('AI Find', () => {
  let notebookId = null
  let testPage = null

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    const nb = await createNotebook(client, userId, `AIFind Notebook ${Date.now()}`)
    notebookId = nb.id
    const sec = await createSection(client, userId, nb.id, 'AIFind Section')
    testPage = await createPage(client, userId, sec.id, 'AIFind Page', SEED_CONTENT)
  })

  test.afterAll(async () => {
    const { client } = await getSupabase()
    await deleteNotebookById(client, notebookId)
  })

  // Deterministic stub: the ai-find edge function returns the two "follow up
  // with people" blocks regardless of the exact query the model would receive.
  const stubAiFind = async (page, matchIds) => {
    await page.route('**/functions/v1/ai-find', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { matchIds } }),
      })
    })
  }

  test('AI toggle is present and on by default', async ({ page }) => {
    await waitForApp(page, `/#pg=${testPage.id}`, { expectedText: 'Send Jerry a weekly update' })

    await page.keyboard.press('Control+f')

    const toggle = page.getByRole('button', { name: 'AI', exact: true })
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })

  test('semantic search highlights matched blocks and cycles with next/prev', async ({ page }) => {
    await stubAiFind(page, ['aifind-jerry', 'aifind-call'])
    await waitForApp(page, `/#pg=${testPage.id}`, { expectedText: 'Send Jerry a weekly update' })

    await page.keyboard.press('Control+f')
    const input = page.locator('.find-input')
    await expect(input).toBeVisible()

    await input.fill('things I need to follow up on with people')

    // Two blocks should pick up the AI highlight class.
    await expect(page.locator('.ProseMirror .ai-find-match')).toHaveCount(2, { timeout: 5000 })

    // Counter reflects "1 of 2".
    await expect(page.locator('.find-count')).toHaveText('1 of 2')

    // First match is the "current" one.
    const current = page.locator('.ProseMirror .ai-find-match.current')
    await expect(current).toHaveCount(1)
    await expect(current).toContainText('Send Jerry a weekly update')

    // Next cycles to the second match.
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.locator('.find-count')).toHaveText('2 of 2')
    await expect(page.locator('.ProseMirror .ai-find-match.current')).toContainText(
      'Call the dentist to reschedule',
    )

    // Next wraps back to the first.
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.locator('.find-count')).toHaveText('1 of 2')

    // Prev wraps back to the last.
    await page.getByRole('button', { name: 'Prev' }).click()
    await expect(page.locator('.find-count')).toHaveText('2 of 2')
  })

  test('toggling AI off reverts to literal substring find with zero AI calls', async ({ page }) => {
    let aiCalls = 0
    await page.route('**/functions/v1/ai-find', async (route) => {
      aiCalls += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { matchIds: ['aifind-jerry'] } }),
      })
    })

    await waitForApp(page, `/#pg=${testPage.id}`, { expectedText: 'Pay rent before the first' })

    await page.keyboard.press('Control+f')
    const toggle = page.getByRole('button', { name: 'AI', exact: true })
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')

    // Literal substring search: "rent" matches one block inline.
    const input = page.locator('.find-input')
    await input.fill('rent')

    await expect(page.locator('.ProseMirror .find-match')).not.toHaveCount(0, { timeout: 5000 })
    // No AI block-level highlights while AI is off.
    await expect(page.locator('.ProseMirror .ai-find-match')).toHaveCount(0)
    expect(aiCalls).toBe(0)
  })
})

// Regression: an AI match whose block lives inside a table cell, below the
// fold, must scroll into view. The block-range selection used for scrolling
// must resolve to a valid inline position inside the cell (not the node
// boundary, which is invalid inside table cells) or scrollIntoView is a no-op.
const TALL_SEED = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id: 'aifind-delta-top' },
      content: [{ type: 'text', text: 'Delta Airlines top reference' }],
    },
    // Filler to push the table well below the fold.
    ...Array.from({ length: 40 }, (_, i) => ({
      type: 'paragraph',
      attrs: { id: `aifind-filler-${i}` },
      content: [{ type: 'text', text: `Filler line ${i} with some words to take vertical space` }],
    })),
    {
      type: 'table',
      attrs: { id: 'aifind-table' },
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              attrs: { colspan: 1, rowspan: 1 },
              content: [
                {
                  type: 'paragraph',
                  attrs: { id: 'aifind-delta' },
                  content: [{ type: 'text', text: 'Delta Airlines: SkyMiles rewards number' }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}

test.describe('AI Find scroll-into-view', () => {
  let notebookId = null
  let testPage = null

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    const nb = await createNotebook(client, userId, `AIFind Scroll ${Date.now()}`)
    notebookId = nb.id
    const sec = await createSection(client, userId, nb.id, 'AIFind Scroll Section')
    testPage = await createPage(client, userId, sec.id, 'AIFind Scroll Page', TALL_SEED)
  })

  test.afterAll(async () => {
    const { client } = await getSupabase()
    await deleteNotebookById(client, notebookId)
  })

  test('a match inside a table cell below the fold scrolls into view', async ({ page }) => {
    await page.route('**/functions/v1/ai-find', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { matchIds: ['aifind-delta'] } }),
      })
    })

    await waitForApp(page, `/#pg=${testPage.id}`, { expectedText: 'Filler line 0' })

    // The table-cell match starts off-screen (below the fold).
    const match = page.locator('.ProseMirror #aifind-delta')
    await expect(match).toHaveCount(1)

    await page.keyboard.press('Control+f')
    const input = page.locator('.find-input')
    await expect(input).toBeVisible()
    await input.fill('the airline loyalty program number')

    await expect(page.locator('.ProseMirror .ai-find-match.current')).toHaveCount(1, { timeout: 5000 })

    // The matched cell must be scrolled into the viewport and clear of the
    // toolbar — whether the toolbar is sticky at the top (desktop) or fixed at
    // the bottom (mobile). The single chrome-aware scroll handles both.
    await expect(async () => {
      const visible = await match.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const toolbar = document.querySelector('.toolbar')
        const tb = toolbar?.getBoundingClientRect()
        const inViewport = r.top >= 0 && r.bottom <= window.innerHeight
        if (!tb) return inViewport
        const clearOfToolbar = r.bottom <= tb.top + 1 || r.top >= tb.bottom - 1
        return inViewport && clearOfToolbar
      })
      expect(visible).toBe(true)
    }).toPass({ timeout: 5000 })
  })

  test('literal Find Next keeps the current highlight above the mobile toolbar', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Mobile toolbar coverage regression')

    await waitForApp(page, `/#pg=${testPage.id}`, { expectedText: 'Delta Airlines top reference' })

    await page.keyboard.press('Control+f')
    const toggle = page.getByRole('button', { name: 'AI', exact: true })
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')

    const input = page.locator('.find-input')
    await expect(input).toBeVisible()
    await input.fill('Delta')
    await expect(page.locator('.find-count')).toHaveText('1 of 2')

    await page.evaluate(() => window.scrollTo(0, 2900))
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.locator('.find-count')).toHaveText('2 of 2')

    const current = page.locator('.ProseMirror .find-match.current')
    await expect(current).toHaveCount(1)
    await expect(async () => {
      const visibleAboveToolbar = await current.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const toolbar = document.querySelector('.toolbar')
        const toolbarTop = toolbar?.getBoundingClientRect().top ?? window.innerHeight
        return r.top >= 0 && r.bottom <= toolbarTop - 16
      })
      expect(visibleAboveToolbar).toBe(true)
    }).toPass({ timeout: 5000 })
  })

  test('desktop Find Next keeps the current highlight below the sticky toolbar', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop sticky top-toolbar coverage')

    await waitForApp(page, `/#pg=${testPage.id}`, { expectedText: 'Delta Airlines top reference' })

    await page.keyboard.press('Control+f')
    const toggle = page.getByRole('button', { name: 'AI', exact: true })
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')

    const input = page.locator('.find-input')
    await expect(input).toBeVisible()
    await input.fill('Delta')
    await expect(page.locator('.find-count')).toHaveText('1 of 2')

    // Scroll the panel so the next match starts off-screen, then jump to it.
    await page.locator('.editor-panel').evaluate((el) => el.scrollTo(0, el.scrollHeight))
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.locator('.find-count')).toHaveText('2 of 2')

    const current = page.locator('.ProseMirror .find-match.current')
    await expect(current).toHaveCount(1)
    // The match must be visible and clear of the sticky toolbar — i.e. fully
    // below the toolbar's bottom edge, not hidden behind/above it.
    await expect(async () => {
      const visibleBelowToolbar = await current.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const toolbar = document.querySelector('.toolbar')
        const tb = toolbar?.getBoundingClientRect()
        const inViewport = r.top >= 0 && r.bottom <= window.innerHeight
        if (!tb) return inViewport
        return inViewport && r.top >= tb.bottom - 1
      })
      expect(visibleBelowToolbar).toBe(true)
    }).toPass({ timeout: 5000 })
  })
})
