/**
 * How a Library notebook appears in the sidebar, and what stays reachable.
 *
 * Two things here are easy to get subtly wrong:
 *
 * 1. Hidden must not mean unopenable. Captures, front pages, Lately and
 *    Activity are all absent as child rows of their section, but every one of
 *    them still opens from a deep link, a citation, or its hoisted row. An
 *    earlier design filtered them at the cache accessor, which hid them from
 *    the tree AND made them impossible to open at all.
 *
 * 2. A section row IS its front page. There is no child row called "Overview";
 *    clicking "Endurance" opens it. The fixture gives that page the LARGEST
 *    sort_order in the section so the test proves selection is by role, not by
 *    the front page happening to sort first.
 */
import { test, expect } from './fixtures'
import {
  clickNavigationItem,
  createNotebook,
  createPage,
  createSection,
  deleteNotebookById,
  ensureNavigationVisible,
  getSupabase,
  waitForApp,
} from './test-helpers'

test.describe('Library notebook', () => {
  let notebookId = null
  let sectionId = null
  let homeSectionId = null
  let frontPage = null
  let topicPage = null
  let capturePage = null

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()

    const notebook = await createNotebook(
      client,
      userId,
      `Library ${Date.now()}`,
      -9990,
      'library',
    )
    notebookId = notebook.id

    const section = await createSection(client, userId, notebook.id, 'Endurance', 0)
    sectionId = section.id

    // sortOrder 5 — LAST in the section. The section row must still open it,
    // because the landing page is chosen by role and not by sort order.
    frontPage = await createPage(
      client,
      userId,
      sectionId,
      'Overview',
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { id: 'lib-index-p1' },
            content: [{ type: 'text', text: 'Front page for the Endurance section.' }],
          },
        ],
      },
      5,
      { libraryRole: 'section_index' },
    )

    capturePage = await createPage(
      client,
      userId,
      sectionId,
      'Carbohydrate intake during long runs',
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { id: 'lib-capture-p1' },
            content: [{ type: 'text', text: 'Saved capture body text.' }],
          },
        ],
      },
      2,
      { libraryRole: 'capture' },
    )

    // A topic catalog that cites the capture — the only way the user reaches it.
    topicPage = await createPage(
      client,
      userId,
      sectionId,
      'Fueling',
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { id: 'lib-topic-p1' },
            content: [
              { type: 'text', text: 'Saved about fueling: ' },
              {
                type: 'text',
                marks: [
                  {
                    type: 'link',
                    attrs: { href: `#pg=${capturePage.id}`, target: '_self', class: null },
                  },
                ],
                text: 'Carbohydrate intake during long runs',
              },
            ],
          },
        ],
      },
      1,
      { libraryRole: 'topic' },
    )

    // The home section, exactly as the rebuild makes it: created last, holding
    // nothing but the two Library-wide pages. It must not appear as a row.
    const home = await createSection(client, userId, notebook.id, 'Home', 1)
    homeSectionId = home.id

    await createPage(
      client,
      userId,
      homeSectionId,
      'Lately',
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { id: 'lib-lately-p1' },
            content: [{ type: 'text', text: 'What landed across the Library.' }],
          },
        ],
      },
      -2,
      { libraryRole: 'lately' },
    )

    await createPage(
      client,
      userId,
      homeSectionId,
      'Activity',
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { id: 'lib-activity-p1' },
            content: [{ type: 'text', text: 'What the app rewrote, and what it skipped.' }],
          },
        ],
      },
      -1,
      { libraryRole: 'activity' },
    )
  })

  test.afterAll(async () => {
    const { client } = await getSupabase()
    await deleteNotebookById(client, notebookId)
  })

  test('only the topic is a child row of its section', async ({ page }) => {
    await waitForApp(page, `#nb=${notebookId}&sec=${sectionId}&pg=${topicPage.id}`)
    await ensureNavigationVisible(page)

    // The topic is listed…
    await expect(page.locator('.tree-node-page', { hasText: 'Fueling' })).toHaveCount(1)
    // …the capture is not, even though it lives in the same section…
    await expect(
      page.locator('.tree-node-page', { hasText: 'Carbohydrate intake during long runs' }),
    ).toHaveCount(0)
    // …and neither is the front page. The section row IS the front page; a
    // child row for it would be the same thing listed twice.
    await expect(page.locator('.tree-node-page', { hasText: 'Overview' })).toHaveCount(0)
  })

  test('the home section is gone and its pages are hoisted around the sections', async ({
    page,
  }) => {
    await waitForApp(page, `#nb=${notebookId}&sec=${sectionId}&pg=${topicPage.id}`)
    await ensureNavigationVisible(page)

    const lately = page.locator('.tree-node-page', { hasText: 'Lately' })
    const activity = page.locator('.tree-node-page', { hasText: 'Activity' })
    const section = page.locator('.tree-node-section', { hasText: 'Endurance' })

    await expect(lately).toHaveCount(1)
    await expect(activity).toHaveCount(1)
    // The section they actually live in has no row at all.
    await expect(page.locator('.tree-node-section', { hasText: 'Home' })).toHaveCount(0)

    // Order is asserted geometrically, not structurally: SortableContext renders
    // no wrapper element, so the hoisted rows are DOM siblings of the section
    // rows and there is nothing to nest an assertion in.
    const [latelyBox, sectionBox, activityBox] = await Promise.all([
      lately.first().boundingBox(),
      section.first().boundingBox(),
      activity.first().boundingBox(),
    ])
    expect(latelyBox.y).toBeLessThan(sectionBox.y)
    expect(activityBox.y).toBeGreaterThan(sectionBox.y)
  })

  test('a hoisted row opens its page', async ({ page }) => {
    await waitForApp(page, `#nb=${notebookId}&sec=${sectionId}&pg=${topicPage.id}`)
    await ensureNavigationVisible(page)

    await clickNavigationItem(
      page,
      page.locator('.tree-node-page', { hasText: 'Lately' }).first(),
    )
    await expect(page.locator('.title-input')).toHaveValue('Lately', { timeout: 10000 })
    await expect(page.locator('.ProseMirror')).toContainText('What landed across the Library')
  })

  test('a topic row is tagged as written by the app', async ({ page }) => {
    await waitForApp(page, `#nb=${notebookId}&sec=${sectionId}&pg=${topicPage.id}`)
    await ensureNavigationVisible(page)

    // Asserted via the accessible name, not the visible text, so shortening the
    // label later does not silently drop the meaning.
    const badge = page
      .locator('.tree-node-page', { hasText: 'Fueling' })
      .getByLabel('Catalog page, written by the app')
    await expect(badge.first()).toBeVisible()
  })

  test('the Library offers a topic to make, never a page to author', async ({ page }) => {
    // Rule 4 still holds — the user never AUTHORS a page here. But naming a
    // topic is theirs to do (rule 2), and after captures were hidden from the
    // tree a disabled button was the only door left in the whole notebook.
    await waitForApp(page, `#nb=${notebookId}&sec=${sectionId}&pg=${topicPage.id}`)
    await ensureNavigationVisible(page)

    await expect(page.getByRole('button', { name: '+ New page' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '+ New topic' })).toBeEnabled()
  })

  test('a capture still opens from a deep link', async ({ page }) => {
    await waitForApp(page, `#nb=${notebookId}&sec=${sectionId}&pg=${capturePage.id}`)

    await expect(page.locator('.title-input')).toHaveValue(
      'Carbohydrate intake during long runs',
      { timeout: 10000 },
    )
    await expect(page.locator('.ProseMirror')).toContainText('Saved capture body text.')
  })

  test('a topic page link navigates to its capture', async ({ page }) => {
    await waitForApp(page, `#nb=${notebookId}&sec=${sectionId}&pg=${topicPage.id}`, {
      expectedText: 'Saved about fueling',
    })

    const citation = page.locator(`.ProseMirror a[href="#pg=${capturePage.id}"]`).first()
    await expect(citation).toBeVisible({ timeout: 10000 })
    await citation.click()

    await expect(page.locator('.title-input')).toHaveValue(
      'Carbohydrate intake during long runs',
      { timeout: 10000 },
    )
  })

  test('the Library survives a reload', async ({ page }) => {
    await waitForApp(page, `#nb=${notebookId}&sec=${sectionId}&pg=${topicPage.id}`, {
      expectedText: 'Saved about fueling',
    })

    await page.reload()
    await expect(page.locator('.title-input')).toHaveValue('Fueling', { timeout: 15000 })
    await expect(page.locator('.ProseMirror')).toContainText('Saved about fueling')

    await ensureNavigationVisible(page)
    await expect(
      page.locator('.tree-node-page', { hasText: 'Carbohydrate intake during long runs' }),
    ).toHaveCount(0)
    // The hoisted rows survive too — they depend on a prefetch that has to run
    // again from cold on every load, not just on first expand.
    await expect(page.locator('.tree-node-page', { hasText: 'Lately' })).toHaveCount(1)
    await expect(page.locator('.tree-node-section', { hasText: 'Home' })).toHaveCount(0)
  })

  test('drag handles cover only the visible pages', async ({ page }) => {
    await waitForApp(page, `#nb=${notebookId}&sec=${sectionId}&pg=${topicPage.id}`)
    await ensureNavigationVisible(page)

    // Reorder handles are generated from the same list the tree renders, so the
    // hidden capture must not contribute one.
    await expect(
      page.getByRole('button', { name: 'Reorder page Carbohydrate intake during long runs' }),
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Reorder page Fueling' })).toHaveCount(1)

    // Nor may the hoisted rows: they are model-owned with fixed sentinel
    // orders, and a focusable handle that cannot move anything is a control
    // that lies.
    await expect(page.getByRole('button', { name: 'Reorder page Lately' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Reorder page Activity' })).toHaveCount(0)
  })

  test('clicking a section opens its front page', async ({ page }) => {
    // Sitting on Fueling, inside the same section — the case the old
    // don't-yank-them-away guard used to turn into a no-op. The front page also
    // has the LARGEST sort_order here, so landing on it proves the choice is by
    // role rather than by order.
    await waitForApp(page, `#nb=${notebookId}&sec=${sectionId}&pg=${topicPage.id}`, {
      expectedText: 'Saved about fueling',
    })
    await ensureNavigationVisible(page)

    await clickNavigationItem(
      page,
      page.locator('.tree-node-section', { hasText: 'Endurance' }).first(),
    )
    await expect(page.locator('.title-input')).toHaveValue('Overview', { timeout: 10000 })
    await expect(page.locator('.ProseMirror')).toContainText('Front page for the Endurance section')
  })

  test('clickNavigationItem still selects a visible Library page', async ({ page }) => {
    await waitForApp(page, `#nb=${notebookId}&sec=${sectionId}&pg=${frontPage.id}`)
    await ensureNavigationVisible(page)

    await clickNavigationItem(
      page,
      page.locator('.tree-node-page', { hasText: 'Fueling' }).first(),
    )
    await expect(page.locator('.title-input')).toHaveValue('Fueling', { timeout: 10000 })
  })
})
