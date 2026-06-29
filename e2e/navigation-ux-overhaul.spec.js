/**
 * Navigation UX overhaul — "movement just works".
 *
 * Covers the headline behaviors from the navigation overhaul:
 *   - Per-page scroll restoration on the correct surface per viewport
 *     (desktop `.editor-panel.scrollTop`, mobile `window.scrollY`); fresh pages
 *     start at the top.
 *   - Create → delete returns you to the page you were on before.
 *   - Clicking a section opens its first page; an empty section shows the
 *     contextual empty state.
 *   - A deep link to a deleted page falls back gracefully with a notice instead
 *     of a blank editor.
 */
import { test, expect } from './fixtures'
import {
  createNotebook,
  createPage,
  createSection,
  deleteNotebookById,
  ensureNavigationVisible,
  getSupabase,
  waitForApp,
} from './test-helpers'

const longContent = (lines) => ({
  type: 'doc',
  content: Array.from({ length: lines }, (_, i) => ({
    type: 'paragraph',
    content: [{ type: 'text', text: `Long page line ${i + 1}` }],
  })),
})

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

test.describe('navigation UX overhaul', () => {
  let notebook = null
  let secMain = null
  let secSecond = null
  let secEmpty = null
  let pageOne = null
  let pageTwo = null
  let pageThree = null
  let longPage = null

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    const stamp = Date.now()
    notebook = await createNotebook(client, userId, `Nav UX ${stamp}`, -9500)
    secMain = await createSection(client, userId, notebook.id, `Main ${stamp}`, 0)
    secSecond = await createSection(client, userId, notebook.id, `Second ${stamp}`, 1)
    secEmpty = await createSection(client, userId, notebook.id, `Empty ${stamp}`, 2)

    pageOne = await createPage(client, userId, secMain.id, 'Page One', {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
    }, 0)
    pageTwo = await createPage(client, userId, secMain.id, 'Page Two', {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }],
    }, 1)
    pageThree = await createPage(client, userId, secMain.id, 'Page Three', {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'three' }] }],
    }, 2)
    longPage = await createPage(client, userId, secMain.id, 'Long Page', longContent(90), 3)
    await createPage(client, userId, secSecond.id, 'Second First', {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second first' }] }],
    }, 0)
  })

  test.afterAll(async () => {
    const { client } = await getSupabase()
    await deleteNotebookById(client, notebook?.id)
  })

  const hashFor = (sectionId, pageId) => `#nb=${notebook.id}&sec=${sectionId}&pg=${pageId}`

  test('restores per-page scroll position on the right surface; fresh pages start at top', async ({
    page,
    isMobile,
  }) => {
    await waitForApp(page, hashFor(secMain.id, longPage.id))
    await expect(page.locator('.title-input')).toHaveValue('Long Page')

    // Scroll the long page down and let the in-memory offset record.
    await setScroll(page, isMobile, 700)
    await page.waitForTimeout(600)
    const saved = await getScroll(page, isMobile)
    expect(saved).toBeGreaterThan(150)

    // Switch away to a short page, then back.
    await gotoHash(page, hashFor(secMain.id, pageOne.id))
    await expect(page.locator('.title-input')).toHaveValue('Page One')
    await gotoHash(page, hashFor(secMain.id, longPage.id))
    await expect(page.locator('.title-input')).toHaveValue('Long Page')

    // Offset is restored (not reset to the top).
    await expect
      .poll(() => getScroll(page, isMobile), { timeout: 5000 })
      .toBeGreaterThan(saved - 80)

    // A page with no scroll memory opens at the top.
    await gotoHash(page, hashFor(secMain.id, pageThree.id))
    await expect(page.locator('.title-input')).toHaveValue('Page Three')
    await expect.poll(() => getScroll(page, isMobile), { timeout: 5000 }).toBeLessThan(40)
  })

  test('create then delete returns to the previously-open page', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept())

    await waitForApp(page, hashFor(secMain.id, pageTwo.id))
    await expect(page.locator('.title-input')).toHaveValue('Page Two')

    // Create a new page in the same section.
    await ensureNavigationVisible(page)
    await page.getByRole('button', { name: '+ New page' }).click()
    await expect(page.locator('.title-input')).toHaveValue('Untitled')

    // Delete the freshly-created page → land back on Page Two.
    await page.locator('.title-actions button.ghost', { hasText: 'Delete' }).click()
    await expect(page.locator('.title-input')).toHaveValue('Page Two', { timeout: 10000 })
  })

  test('clicking a section opens its first page', async ({ page }) => {
    await waitForApp(page, hashFor(secMain.id, pageOne.id))
    await ensureNavigationVisible(page)

    await page
      .locator('.tree-node-section', { hasText: secSecond.title })
      .first()
      .click()

    await expect(page.locator('.title-input')).toHaveValue('Second First', { timeout: 10000 })
  })

  test('clicking an empty section shows the contextual empty state', async ({ page }) => {
    await waitForApp(page, hashFor(secMain.id, pageOne.id))
    await ensureNavigationVisible(page)

    await page
      .locator('.tree-node-section', { hasText: secEmpty.title })
      .first()
      .click()

    await expect(page.locator('.editor-empty')).toContainText('This section is empty', {
      timeout: 10000,
    })
  })

  test('deep link to a deleted page falls back with a notice instead of a blank editor', async ({
    page,
  }) => {
    const { client, userId } = await getSupabase()
    // A throwaway page reached directly by deep link, then deleted out from under us.
    const doomed = await createPage(
      client,
      userId,
      secSecond.id,
      'Doomed Page',
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'doomed' }] }] },
      5,
    )

    await waitForApp(page, hashFor(secMain.id, pageOne.id))
    await client.from('pages').delete().eq('id', doomed.id)

    // Navigate to the now-dead deep link.
    await gotoHash(page, hashFor(secSecond.id, doomed.id))

    // Graceful notice, no blank dead-end, and the address bar is rewritten off
    // the dead page id.
    await expect(page.locator('.message-inline')).toContainText('no longer exists', {
      timeout: 10000,
    })
    await expect
      .poll(() => page.evaluate(() => window.location.hash), { timeout: 10000 })
      .not.toContain(doomed.id)
  })
})
