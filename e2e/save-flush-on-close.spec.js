/**
 * Edit a page → close the tab well inside the 2s autosave debounce → assert the
 * server actually received the edit.
 *
 * This is the case flushAll()'s keepalive beacon exists for. Before it, flushAll
 * wrote the draft to localStorage (so text was never *lost*) and then fired a
 * normal fetch that the browser was free to kill as the tab tore down — leaving
 * the newer text stranded in one browser's localStorage while every other device
 * showed the stale version. Reading the row straight from Supabase, rather than
 * reopening the page in the same browser, is what makes this test see the
 * difference: a localStorage-only save would still look correct in the UI.
 */
import { test, expect } from './fixtures'
import {
  createNotebook,
  createPage,
  createSection,
  deleteNotebookById,
  getSupabase,
  waitForApp,
} from './test-helpers'

test.describe('save flush on tab close', () => {
  let notebook = null
  let section = null
  let target = null

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    const stamp = Date.now()
    notebook = await createNotebook(client, userId, `Close ${stamp}`, -8901)
    section = await createSection(client, userId, notebook.id, 'Close Sec', 0)
    target = await createPage(client, userId, section.id, 'Close Page', {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original close content' }] }],
    })
  })

  test.afterAll(async () => {
    const { client } = await getSupabase()
    await deleteNotebookById(client, notebook?.id)
  })

  test('an edit reaches the server when the tab closes before the debounce fires', async ({
    page,
  }) => {
    const hash = `#nb=${notebook.id}&sec=${section.id}&pg=${target.id}`
    await waitForApp(page, hash)
    await expect(page.locator('.ProseMirror')).toContainText('Original close content')

    await page.locator('.ProseMirror').click()
    await page.keyboard.press('End')
    await page.keyboard.type(' — closed fast')

    // Well inside SAVE_DELAY (2000ms), so nothing has been sent yet.
    await page.waitForTimeout(200)

    // runBeforeUnload lets the app's beforeunload/pagehide handlers run, which is
    // what calls flushAllPendingSaves(). The context stays alive so the keepalive
    // request can finish, exactly as it would after a real tab close.
    await page.close({ runBeforeUnload: true })

    const { client } = await getSupabase()
    await expect
      .poll(
        async () => {
          const { data } = await client
            .from('pages')
            .select('content')
            .eq('id', target.id)
            .maybeSingle()
          return JSON.stringify(data?.content ?? {})
        },
        { timeout: 10000, message: 'server never received the pre-close edit' },
      )
      .toContain('closed fast')
  })
})
