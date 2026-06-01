// Sync regression: optimistic-concurrency conflict at save time.
//
// Repro: load a page in the browser, simulate "another device" writing the
// same row via the Supabase API (bumps updated_at), then make a local edit.
// The save should detect the version mismatch and surface ConflictModal
// instead of silently overwriting the other device's content.

import { test, expect } from './fixtures'
import { getSupabase, createNotebook, createSection, createPage, deleteNotebookById, waitForApp } from './test-helpers'

const INITIAL_CONTENT = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Initial shared content.' }] },
  ],
}

const REMOTE_DEVICE_CONTENT = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Remote Device Edit' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Written by the other device.' }] },
  ],
}

test.describe('Save-time OCC conflict prevents stale overwrite', () => {
  let supabaseInfo = null
  let notebookId = null
  let sectionId = null
  let testPage = null

  test.beforeAll(async () => {
    supabaseInfo = await getSupabase()
    const nb = await createNotebook(supabaseInfo.client, supabaseInfo.userId, `OCC Notebook ${Date.now()}`)
    notebookId = nb.id
    const sec = await createSection(supabaseInfo.client, supabaseInfo.userId, nb.id, 'OCC Section')
    sectionId = sec.id
  })

  test.afterAll(async () => {
    if (!supabaseInfo?.client) return
    await deleteNotebookById(supabaseInfo.client, notebookId)
  })

  test('a stale save surfaces ConflictModal instead of overwriting the server', async ({ page }) => {
    testPage = await createPage(supabaseInfo.client, supabaseInfo.userId, sectionId, 'OCC Test Page', INITIAL_CONTENT)

    // Open the page in the browser — this caches the current updated_at as the
    // OCC token. Wait for the editor to fully render the initial content.
    await waitForApp(page, `/#pg=${testPage.id}`)
    await expect(page.locator('.ProseMirror')).toContainText('Initial shared content.', { timeout: 15000 })

    // Make a local edit first, so the browser holds a stale draft and the
    // realtime handler must not adopt the incoming server version as the new
    // OCC baseline.
    await page.locator('.ProseMirror').click()
    await page.keyboard.type(' Local edit on top of stale snapshot.')
    await expect(page.locator('.ProseMirror')).toContainText('Local edit on top of stale snapshot.')

    // Simulate "the other device" writing the row via the API directly before
    // the 2s autosave debounce fires. This advances updated_at without going
    // through our save path.
    const futureTs = new Date(Date.now() + 60_000).toISOString()
    const { error: remoteWriteError } = await supabaseInfo.client
      .from('pages')
      .update({ content: REMOTE_DEVICE_CONTENT, updated_at: futureTs })
      .eq('id', testPage.id)
    expect(remoteWriteError).toBeNull()

    // ConflictModal should appear. The existing draft-conflict copy is reused.
    await expect(page.locator('.conflict-modal')).toBeVisible({ timeout: 15000 })

    // Critical: server content must still be the remote-device write, NOT our
    // stale-overlay edit. If OCC were broken, the save would have clobbered it.
    await expect(async () => {
      const { data, error } = await supabaseInfo.client
        .from('pages')
        .select('content')
        .eq('id', testPage.id)
        .single()
      if (error) throw error
      const serverText = JSON.stringify(data?.content)
      expect(serverText).toContain('Remote Device Edit')
      expect(serverText).not.toContain('Local edit on top of stale snapshot.')
    }).toPass({ timeout: 10000 })
  })
})
