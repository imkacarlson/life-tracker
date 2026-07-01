/**
 * Scroll + cursor restoration — general, in-session, desktop + mobile.
 *
 * The editor is torn down and rebuilt from scratch on every page switch
 * (`useEditor(..., [sessionKey])`), so every navigation races a fresh layout.
 * `useScrollRestoration` stores `{ scrollTop, selection }` per page and re-applies
 * both once the rebuilt editor lays out (waiting via ResizeObserver for late-
 * growing content). This spec is the safety net that keeps that behavior honest
 * across the page types the user actually jumps between — long text, a tall
 * table, and a page containing an image — on BOTH viewport projects.
 *
 * Surface-aware: desktop scrolls `.editor-panel`, mobile scrolls `window`.
 * The mobile read-mode test is the explicit regression guard for the #194
 * failure (navigating to read a page must not steal focus / pop the keyboard).
 */
import { test, expect } from './fixtures'
import {
  createNotebook,
  createPage,
  createSection,
  deleteNotebookById,
  ensureNavigationVisible,
  getSupabase,
  tallTableContent,
  waitForApp,
} from './test-helpers'

// Minimal 1x1 transparent PNG as a data URI so the <img> renders immediately
// without waiting for Supabase Storage signed-URL hydration.
const TINY_PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg=='

const longContent = (lines) => ({
  type: 'doc',
  content: Array.from({ length: lines }, (_, i) => ({
    type: 'paragraph',
    content: [{ type: 'text', text: `Long page line ${i + 1}` }],
  })),
})

// An image above the fold, then enough text below to make the page scrollable.
// The future-images generality guard: restoration must work on a page whose
// content includes an image node, with no stored image dimensions.
const imagePageContent = (trailingLines) => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Above the image' }] },
    { type: 'image', attrs: { src: TINY_PNG_DATA_URI, alt: 'seed image' } },
    ...Array.from({ length: trailingLines }, (_, i) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: `Below image line ${i + 1}` }],
    })),
  ],
})

// --- Surface-aware helpers (desktop `.editor-panel`, mobile `window`) --------
const getScroll = (page, isMobile) =>
  page.evaluate((mob) => {
    if (mob) return window.scrollY
    const el = document.querySelector('.editor-panel')
    return el ? el.scrollTop : 0
  }, isMobile)

const setScroll = (page, isMobile, top) =>
  page.evaluate(
    ({ mob, value }) => {
      if (mob) {
        window.scrollTo(0, value)
      } else {
        const el = document.querySelector('.editor-panel')
        if (el) el.scrollTop = value
      }
    },
    { mob: isMobile, value: top },
  )

const gotoHash = async (page, hash) => {
  await page.evaluate(() => {
    window.location.hash = ''
  })
  await page.evaluate((h) => {
    window.location.hash = h
  }, hash)
}

// `window.__lifeTrackerEditor` is exposed in dev (EditorPanel.jsx) and points at
// the currently-mounted editor — re-set after every page-switch remount.
const getEditorSelection = (page) =>
  page.evaluate(() => {
    const ed = window.__lifeTrackerEditor
    if (!ed || ed.isDestroyed || !ed.state?.selection) return null
    const { from, to } = ed.state.selection
    return { from, to }
  })

const setEditorSelection = (page, from, to) =>
  page.evaluate(
    ({ f, t }) => {
      const ed = window.__lifeTrackerEditor
      if (!ed || ed.isDestroyed) return null
      ed.commands.setTextSelection({ from: f, to: t })
      const sel = ed.state.selection
      return { from: sel.from, to: sel.to }
    },
    { f: from, t: to },
  )

const editorHasFocus = (page) =>
  page.evaluate(() => {
    const ed = window.__lifeTrackerEditor
    if (!ed || ed.isDestroyed) return false
    return Boolean(ed.view?.hasFocus?.())
  })

test.describe('scroll + cursor restoration', () => {
  let notebook = null
  let section = null
  let longPage = null
  let tablePage = null
  let imagePage = null
  let shortPage = null

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    const stamp = Date.now()
    notebook = await createNotebook(client, userId, `Scroll Cursor ${stamp}`, -9600)
    section = await createSection(client, userId, notebook.id, `Pages ${stamp}`, 0)

    longPage = await createPage(client, userId, section.id, 'Long Text Page', longContent(90), 0)
    tablePage = await createPage(client, userId, section.id, 'Tall Table Page', tallTableContent(40), 1)
    imagePage = await createPage(client, userId, section.id, 'Image Page', imagePageContent(80), 2)
    shortPage = await createPage(
      client,
      userId,
      section.id,
      'Short Page',
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'short' }] }] },
      3,
    )
  })

  test.afterAll(async () => {
    const { client } = await getSupabase()
    await deleteNotebookById(client, notebook?.id)
  })

  const hashFor = (pageId) => `#nb=${notebook.id}&sec=${section.id}&pg=${pageId}`

  // Scroll a page, leave to the short page, come back, assert the offset returns.
  const assertScrollRestored = async (page, isMobile, targetPage, targetTitle) => {
    await waitForApp(page, hashFor(targetPage.id))
    await expect(page.locator('.title-input')).toHaveValue(targetTitle)

    await setScroll(page, isMobile, 600)
    await page.waitForTimeout(600)
    const saved = await getScroll(page, isMobile)
    expect(saved).toBeGreaterThan(150)

    // Navigate away to a short page, then back.
    await gotoHash(page, hashFor(shortPage.id))
    await expect(page.locator('.title-input')).toHaveValue('Short Page')
    await gotoHash(page, hashFor(targetPage.id))
    await expect(page.locator('.title-input')).toHaveValue(targetTitle)

    await expect
      .poll(() => getScroll(page, isMobile), { timeout: 5000 })
      .toBeGreaterThan(saved - 80)
  }

  test('1. scroll restored on return — long-text page', async ({ page, isMobile }) => {
    await assertScrollRestored(page, isMobile, longPage, 'Long Text Page')
  })

  test('2. scroll restored on return — tall-table page', async ({ page, isMobile }) => {
    await assertScrollRestored(page, isMobile, tablePage, 'Tall Table Page')
  })

  test('2b. scroll restored on return — page with an image (future-images guard)', async ({
    page,
    isMobile,
  }) => {
    await waitForApp(page, hashFor(imagePage.id))
    await expect(page.locator('.title-input')).toHaveValue('Image Page')
    // The image node renders (proves restoration happens on an image-bearing page).
    await expect(page.locator('.ProseMirror img')).toHaveCount(1, { timeout: 10000 })

    await setScroll(page, isMobile, 600)
    await page.waitForTimeout(600)
    const saved = await getScroll(page, isMobile)
    expect(saved).toBeGreaterThan(150)

    await gotoHash(page, hashFor(shortPage.id))
    await expect(page.locator('.title-input')).toHaveValue('Short Page')
    await gotoHash(page, hashFor(imagePage.id))
    await expect(page.locator('.title-input')).toHaveValue('Image Page')

    // Once the image-grown content settles, the offset comes back.
    await expect
      .poll(() => getScroll(page, isMobile), { timeout: 5000 })
      .toBeGreaterThan(saved - 80)
  })

  test('3. cursor/selection restored on return without scrolling to the caret', async ({
    page,
    isMobile,
  }) => {
    await waitForApp(page, hashFor(longPage.id))
    await expect(page.locator('.title-input')).toHaveValue('Long Text Page')

    // Place a selection far down the document while the page stays at the top.
    let expected = null
    await expect
      .poll(async () => {
        expected = await setEditorSelection(page, 1200, 1210)
        return expected
      }, { timeout: 5000 })
      .not.toBeNull()
    // Let the (debounced) selection capture record before navigating away.
    await page.waitForTimeout(500)

    await gotoHash(page, hashFor(shortPage.id))
    await expect(page.locator('.title-input')).toHaveValue('Short Page')
    await gotoHash(page, hashFor(longPage.id))
    await expect(page.locator('.title-input')).toHaveValue('Long Text Page')

    // Selection lands back where it was…
    await expect
      .poll(() => getEditorSelection(page), { timeout: 5000 })
      .toEqual(expected)

    // …and the page did NOT scroll to the (offscreen) caret.
    expect(await getScroll(page, isMobile)).toBeLessThan(40)
  })

  test('4. never-visited page starts at the top', async ({ page, isMobile }) => {
    // Visit + scroll the long page so the reused scroll container is non-zero.
    await waitForApp(page, hashFor(longPage.id))
    await expect(page.locator('.title-input')).toHaveValue('Long Text Page')
    await setScroll(page, isMobile, 600)
    await page.waitForTimeout(600)
    expect(await getScroll(page, isMobile)).toBeGreaterThan(150)

    // Switch to a tall page never visited this session → it must reset to top,
    // not inherit the previous page's offset from the shared container.
    await gotoHash(page, hashFor(tablePage.id))
    await expect(page.locator('.title-input')).toHaveValue('Tall Table Page')
    await expect.poll(() => getScroll(page, isMobile), { timeout: 5000 }).toBeLessThan(40)
  })

  test('5. mobile read-mode keeps the keyboard down while restoring', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Mobile-only: virtual-keyboard regression guard for #194')

    // Seed a scroll offset on the table page via hash nav (no editor focus).
    await waitForApp(page, hashFor(tablePage.id))
    await expect(page.locator('.title-input')).toHaveValue('Tall Table Page')
    await setScroll(page, isMobile, 600)
    await page.waitForTimeout(600)
    const saved = await getScroll(page, isMobile)
    expect(saved).toBeGreaterThan(150)

    // Read another page, then come back — by TAPPING the sidebar, not the editor.
    const tapPageInSidebar = async (title) => {
      await ensureNavigationVisible(page)
      await page.locator('.tree-node-page', { hasText: title }).first().click()
      await expect(page.locator('.title-input')).toHaveValue(title, { timeout: 10000 })
    }

    await tapPageInSidebar('Short Page')
    await tapPageInSidebar('Tall Table Page')

    // Restore still happens…
    await expect
      .poll(() => getScroll(page, isMobile), { timeout: 5000 })
      .toBeGreaterThan(saved - 80)

    // …and reading the page did not steal focus / pop the keyboard.
    expect(await editorHasFocus(page)).toBe(false)
  })
})
