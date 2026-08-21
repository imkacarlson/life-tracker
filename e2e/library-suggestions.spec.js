/**
 * "Worth a topic?" — the block that shows what the app noticed and lets you act
 * on it.
 *
 * Three things here are easy to get subtly wrong:
 *
 * 1. The suggestion level has to match the page level. Lately is Library-wide
 *    so it offers SECTIONS; a section's front page offers TOPICS in that
 *    section. A card offering the wrong one is worse than no card.
 *
 * 2. The block must never appear anywhere else. It is a control surface for two
 *    specific pages, not a fixture of the editor.
 *
 * 3. The block must never empty. At zero suggestions it is still one card — the
 *    door you walk through when you already know the name — because a Library
 *    with two things in it has to read as usable rather than broken.
 *
 * No model call is involved anywhere below: the noticing pass writes rows, the
 * panel renders rows, and the rows here are seeded directly.
 */
import { test, expect } from './fixtures'
import {
  clearLibrarySuggestions,
  createLibrarySuggestion,
  createNotebook,
  createPage,
  createSection,
  deleteNotebookById,
  ensureNavigationVisible,
  getSupabase,
  waitForApp,
} from './test-helpers'

const paragraph = (id, text) => ({
  type: 'doc',
  content: [{ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] }],
})

test.describe('Library suggestions', () => {
  let userId = null
  let notebookId = null
  let sectionId = null
  let homeSectionId = null
  let frontPage = null
  let topicPage = null
  let latelyPage = null
  let trackerPage = null
  let trackerNotebookId = null
  let trackerSectionId = null

  test.beforeAll(async () => {
    const supabase = await getSupabase()
    const { client } = supabase
    userId = supabase.userId

    const notebook = await createNotebook(client, userId, `Library ${Date.now()}`, -9980, 'library')
    notebookId = notebook.id

    const section = await createSection(client, userId, notebook.id, 'Running', 0)
    sectionId = section.id

    frontPage = await createPage(
      client,
      userId,
      sectionId,
      'Overview',
      paragraph('sug-index-p1', 'Front page for the Running section.'),
      5,
      { libraryRole: 'section_index' },
    )

    topicPage = await createPage(
      client,
      userId,
      sectionId,
      'Fueling',
      paragraph('sug-topic-p1', 'Saved about fueling.'),
      1,
      { libraryRole: 'topic' },
    )

    const home = await createSection(client, userId, notebook.id, 'Home', 1)
    homeSectionId = home.id

    latelyPage = await createPage(
      client,
      userId,
      homeSectionId,
      'Lately',
      paragraph('sug-lately-p1', 'What landed across the Library.'),
      -2,
      { libraryRole: 'lately' },
    )

    // A tracker page, to prove the block belongs to the Library and not to the
    // editor.
    const trackerNotebook = await createNotebook(
      client,
      userId,
      `Tracker ${Date.now()}`,
      -9979,
      'tracker',
    )
    trackerNotebookId = trackerNotebook.id
    const trackerSection = await createSection(client, userId, trackerNotebook.id, 'August', 0)
    trackerSectionId = trackerSection.id
    trackerPage = await createPage(
      client,
      userId,
      trackerSectionId,
      'August 2026 Tracker',
      paragraph('sug-tracker-p1', 'An ordinary tracker page.'),
      0,
    )
  })

  test.beforeEach(async () => {
    const { client } = await getSupabase()
    // A card left behind by an interrupted run would change what the block
    // contains, so every test starts from a known live set.
    await clearLibrarySuggestions(client, userId)
  })

  test.afterAll(async () => {
    const { client } = await getSupabase()
    await clearLibrarySuggestions(client, userId)
    await deleteNotebookById(client, notebookId)
    await deleteNotebookById(client, trackerNotebookId)
  })

  test('Lately offers sections, over the whole Library', async ({ page }) => {
    const { client } = await getSupabase()
    await createLibrarySuggestion(client, userId, {
      scope: 'section',
      title: 'Health IT',
      why: '3 saved, all about hospital systems',
    })

    await waitForApp(page, `#nb=${notebookId}&sec=${homeSectionId}&pg=${latelyPage.id}`)

    await expect(page.getByRole('heading', { name: 'Worth a section?' })).toBeVisible({
      timeout: 15000,
    })
    await expect(page.getByText('3 saved, all about hospital systems')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Make it a section' })).toBeVisible()
  })

  test("a section's front page offers topics inside that section", async ({ page }) => {
    const { client } = await getSupabase()
    await createLibrarySuggestion(client, userId, {
      scope: 'topic',
      sectionId,
      title: 'Bouncing back',
      why: '2 saved, both about recovering from a rough race',
    })

    await waitForApp(page, `#nb=${notebookId}&sec=${sectionId}&pg=${frontPage.id}`)

    await expect(page.getByRole('heading', { name: 'Worth a topic?' })).toBeVisible({
      timeout: 15000,
    })
    await expect(page.getByText('2 saved, both about recovering from a rough race')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Make it a topic' })).toBeVisible()
  })

  test('a suggestion never leaks onto a page it is not about', async ({ page }) => {
    const { client } = await getSupabase()
    await createLibrarySuggestion(client, userId, {
      scope: 'topic',
      sectionId,
      title: 'Bouncing back',
      why: '2 saved, both about recovering from a rough race',
    })

    // A topic page is inside the same section, and still shows nothing: a topic
    // does not contain topics.
    await waitForApp(page, `#nb=${notebookId}&sec=${sectionId}&pg=${topicPage.id}`, {
      expectedText: 'Saved about fueling',
    })
    await expect(page.locator('.library-suggestions')).toHaveCount(0)

    // Neither does an ordinary tracker page.
    await waitForApp(page, `#nb=${trackerNotebookId}&sec=${trackerSectionId}&pg=${trackerPage.id}`, {
      expectedText: 'An ordinary tracker page',
    })
    await expect(page.locator('.library-suggestions')).toHaveCount(0)
  })

  test('the block never empties — with nothing noticed it is still a door', async ({ page }) => {
    await waitForApp(page, `#nb=${notebookId}&sec=${sectionId}&pg=${frontPage.id}`)

    await expect(page.getByRole('heading', { name: 'Worth a topic?' })).toBeVisible({
      timeout: 15000,
    })
    await expect(page.getByRole('button', { name: 'Make your own' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Make it a topic' })).toHaveCount(0)
  })

  test('“Not interested” takes the card away, and it stays away', async ({ page }) => {
    const { client } = await getSupabase()
    await createLibrarySuggestion(client, userId, {
      scope: 'topic',
      sectionId,
      title: 'Bouncing back',
      why: '2 saved, both about recovering from a rough race',
    })

    await waitForApp(page, `#nb=${notebookId}&sec=${sectionId}&pg=${frontPage.id}`)
    const card = page.getByText('2 saved, both about recovering from a rough race')
    await expect(card).toBeVisible({ timeout: 15000 })

    // The card leaves optimistically, so the write has to be waited for
    // separately: reloading while the PATCH is still in flight would abort it
    // and test nothing.
    const persisted = page.waitForResponse(
      (response) =>
        response.url().includes('/library_suggestions') &&
        response.request().method() === 'PATCH',
    )
    await page.getByRole('button', { name: 'Not interested' }).click()
    await expect(card).toHaveCount(0)
    await persisted

    // The dismissal is persisted, not just hidden — otherwise the same card
    // returns every week and the block becomes a chore.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Worth a topic?' })).toBeVisible({
      timeout: 15000,
    })
    await expect(page.getByText('2 saved, both about recovering from a rough race')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Make your own' })).toBeVisible()
  })

  test('“Make it a topic” creates it, and the sidebar says the app owns it', async ({ page }) => {
    const { client } = await getSupabase()
    const title = `Bouncing back ${Date.now()}`
    await createLibrarySuggestion(client, userId, {
      scope: 'topic',
      sectionId,
      title,
      why: '2 saved, both about recovering from a rough race',
    })

    await waitForApp(page, `#nb=${notebookId}&sec=${sectionId}&pg=${frontPage.id}`)
    await expect(page.getByRole('button', { name: 'Make it a topic' })).toBeVisible({
      timeout: 15000,
    })
    await page.getByRole('button', { name: 'Make it a topic' }).click()

    // It opens, empty and gathering — no backfill, no second model call.
    await expect(page.locator('.title-input')).toHaveValue(title, { timeout: 15000 })
    await expect(page.locator('.ProseMirror')).toContainText('Nothing filed here yet')

    await ensureNavigationVisible(page)
    const row = page.locator('.tree-node-page', { hasText: title })
    await expect(row).toHaveCount(1)
    await expect(row.getByLabel('Catalog page, written by the app')).toBeVisible()

    // Spent, not rejected: the card is gone from the block it came from.
    await waitForApp(page, `#nb=${notebookId}&sec=${sectionId}&pg=${frontPage.id}`)
    await expect(page.getByRole('button', { name: 'Make it a topic' })).toHaveCount(0)
  })

  test('the empty slot opens a dialog and makes a real topic', async ({ page }) => {
    const title = `Long runs ${Date.now()}`
    await waitForApp(page, `#nb=${notebookId}&sec=${sectionId}&pg=${frontPage.id}`)

    await page.getByRole('button', { name: 'Make your own' }).click()
    const dialog = page.getByRole('dialog', { name: 'New topic' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('textbox').fill(title)
    await dialog.getByRole('button', { name: 'Create' }).click()

    await expect(page.locator('.title-input')).toHaveValue(title, { timeout: 15000 })
    await ensureNavigationVisible(page)
    await expect(page.locator('.tree-node-page', { hasText: title })).toHaveCount(1)
  })

  test('the sidebar footer is the same door', async ({ page }) => {
    const title = `Shoes ${Date.now()}`
    await waitForApp(page, `#nb=${notebookId}&sec=${sectionId}&pg=${frontPage.id}`)
    await ensureNavigationVisible(page)

    await page.getByRole('button', { name: '+ New topic' }).click()
    const dialog = page.getByRole('dialog', { name: 'New topic' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('textbox').fill(title)
    await dialog.getByRole('button', { name: 'Create' }).click()

    await expect(page.locator('.title-input')).toHaveValue(title, { timeout: 15000 })
  })

  test('a topic cannot be made in the section the user never made', async ({ page }) => {
    // Lately lives in the home section, whose row is suppressed. A topic put
    // there would have no row and no way back to it.
    await waitForApp(page, `#nb=${notebookId}&sec=${homeSectionId}&pg=${latelyPage.id}`)
    await ensureNavigationVisible(page)

    await expect(page.getByRole('button', { name: '+ New topic' })).toBeDisabled()
  })
})
