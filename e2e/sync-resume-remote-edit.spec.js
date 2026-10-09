// Sync regression: coming back to a page that another device edited.
//
// Repro of the real incident: the phone had a page open, the laptop then
// edited it, and when the phone came back to the foreground it still showed
// the old copy. Typing there saved the old copy plus the new typing over the
// laptop's work.
//
// Expected now: on resume the app pulls in the other device's version and puts
// it on screen before you can type, so new typing lands on top of it.

import { test, expect } from './fixtures'
import { getSupabase, createNotebook, createSection, createPage, deleteNotebookById, waitForApp } from './test-helpers'

const INITIAL_CONTENT = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original phone copy.' }] }],
}

const LAPTOP_CONTENT = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Original phone copy.' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Laptop work that must survive.' }] },
  ],
}

// Fake the app going to the background and coming back, which is what fires
// the resume refresh (see useResumeRefresh).
const simulateBackgroundAndResume = (page) =>
  page.evaluate(() => {
    const setVisibility = (state) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
      document.dispatchEvent(new Event('visibilitychange'))
    }
    setVisibility('hidden')
    setVisibility('visible')
  })

test.describe('Resume pulls in edits made on another device', () => {
  let supabaseInfo = null
  let notebookId = null
  let sectionId = null

  test.beforeAll(async () => {
    supabaseInfo = await getSupabase()
    const nb = await createNotebook(supabaseInfo.client, supabaseInfo.userId, `Resume Notebook ${Date.now()}`)
    notebookId = nb.id
    const sec = await createSection(supabaseInfo.client, supabaseInfo.userId, nb.id, 'Resume Section')
    sectionId = sec.id
  })

  test.afterAll(async () => {
    if (!supabaseInfo?.client) return
    await deleteNotebookById(supabaseInfo.client, notebookId)
  })

  test('typing after resume builds on the other device version instead of overwriting it', async ({ page }) => {
    const testPage = await createPage(
      supabaseInfo.client,
      supabaseInfo.userId,
      sectionId,
      'Resume Test Page',
      INITIAL_CONTENT,
    )

    await waitForApp(page, `/#pg=${testPage.id}`)
    const editor = page.locator('.ProseMirror')
    await expect(editor).toContainText('Original phone copy.', { timeout: 15000 })

    // "The laptop" edits the page while this tab sits in the background. Use a
    // real timestamp: the incident happened because the other device's write
    // was older by the clock than the phone's next keystroke.
    const { error: remoteWriteError } = await supabaseInfo.client
      .from('pages')
      .update({ content: LAPTOP_CONTENT, updated_at: new Date().toISOString() })
      .eq('id', testPage.id)
    expect(remoteWriteError).toBeNull()

    await simulateBackgroundAndResume(page)

    // The laptop's edit shows up on screen (via realtime or the resume fetch).
    await expect(editor).toContainText('Laptop work that must survive.', { timeout: 15000 })

    // Now type, the way you would right after picking the phone back up.
    await editor.click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type(' Phone addition.')
    await expect(page.locator('.status-row')).toContainText('Saved', { timeout: 10000 })

    // The server keeps the laptop's work AND the new typing, with no conflict.
    await expect(async () => {
      const { data, error } = await supabaseInfo.client
        .from('pages')
        .select('content')
        .eq('id', testPage.id)
        .single()
      if (error) throw error
      const serverText = JSON.stringify(data?.content)
      expect(serverText).toContain('Laptop work that must survive.')
      expect(serverText).toContain('Phone addition.')
    }).toPass({ timeout: 10000 })
    await expect(page.locator('.conflict-modal')).toHaveCount(0)
  })
})
