// Regression: Issue #77 — draft conflict resolution
// Found by /investigate + /qa on 2026-03-19
// "Use server version" was not working because:
// 1. activeDraft useMemo was stale after clearing localStorage
// 2. Tiptap editor content was not refreshed after conflict resolution

import { test, expect } from './fixtures'
import { getSupabase, createNotebook, createSection, createPage, deleteNotebookById, waitForApp } from './test-helpers'

const SERVER_CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Server Version Heading' }],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'This is the server version content.' }],
    },
  ],
}

const DRAFT_CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'STALE DRAFT CONTENT' }],
    },
  ],
}

test.describe('Issue #77 draft conflict resolution', () => {
  let supabaseInfo = null
  let notebookId = null
  let testPage = null
  let sectionId = null

  test.beforeAll(async () => {
    supabaseInfo = await getSupabase()
    const nb = await createNotebook(supabaseInfo.client, supabaseInfo.userId, `Issue77 Notebook ${Date.now()}`)
    notebookId = nb.id
    const sec = await createSection(supabaseInfo.client, supabaseInfo.userId, nb.id, 'Issue77 Section')
    sectionId = sec.id
  })

  test.afterAll(async () => {
    if (!supabaseInfo?.client) return
    await deleteNotebookById(supabaseInfo.client, notebookId)
  })

  const setupConflict = async (page) => {
    if (!sectionId) return null
    // Create a temporary page with known server content (fresh each test)
    const { client, userId } = supabaseInfo
    testPage = await createPage(client, userId, sectionId, 'Conflict Test Page', SERVER_CONTENT)

    // Load the app shell first so we can seed localStorage on the app origin.
    // The actual conflict is then exercised via a cold load directly into the
    // conflicted page, instead of relying on same-session hash navigation.
    await page.goto('/')
    await page.waitForSelector('.app:not(.app-auth)', { timeout: 15000 })

    // Inject a stale draft for our test page (timestamp 1 hour in the past)
    const staleTs = Date.now() - 3600000
    await page.evaluate(
      ({ pageId, content, ts }) => {
        localStorage.setItem(
          `lifeTracker:draft:page:${pageId}`,
          JSON.stringify({ title: 'Conflict Test Page', content, ts }),
        )
      },
      { pageId: testPage.id, content: DRAFT_CONTENT, ts: staleTs },
    )

    // Update server timestamp to be newer than the draft.
    // We set it to NOW which is guaranteed newer than staleTs (1 hour ago).
    // Then we poll until the server reflects a timestamp newer than staleTs,
    // without asserting the exact format (Postgres may normalize Z → +00:00).
    await supabaseInfo.client
      .from('pages')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', testPage.id)

    await expect(async () => {
      const { data, error } = await supabaseInfo.client
        .from('pages')
        .select('updated_at')
        .eq('id', testPage.id)
        .single()
      if (error) throw error
      const serverMs = new Date(data?.updated_at).getTime()
      expect(serverMs).toBeGreaterThan(staleTs)
    }).toPass({ timeout: 10000 })

    // Navigate into the target page through the app's hashchange path after
    // seeding localStorage. Direct cold-loading to /#pg=<id> can still miss
    // page resolution on startup, which is a separate app/navigation issue.
    await waitForApp(page, `/#pg=${testPage.id}`)

    // Wait for conflict modal to appear
    await expect(page.locator('.conflict-modal')).toBeVisible({ timeout: 15000 })

    return testPage
  }

  test('Use server version replaces editor content and shows Saved status', async ({ page }) => {
    const tp = await setupConflict(page)
    test.skip(!tp, 'Could not set up conflict scenario (missing seed section)')

    // Verify modal is showing
    await expect(page.locator('.conflict-modal')).toContainText('Draft conflict detected')

    // Click "Use server version"
    await page.locator('.conflict-modal button', { hasText: 'Use server version' }).click()

    // Modal should disappear
    await expect(page.locator('.conflict-modal')).not.toBeVisible({ timeout: 3000 })

    // Editor should show server content, not draft content
    await expect(page.locator('.ProseMirror')).toContainText('Server Version Heading', {
      timeout: 5000,
    })
    await expect(page.locator('.ProseMirror')).not.toContainText('STALE DRAFT CONTENT')

    // Status should show "Saved" (not "Unsaved (local)")
    await expect(page.locator('text=Saved')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('text=Unsaved')).not.toBeVisible()

    // Draft should be cleared from localStorage
    const draft = await page.evaluate((pageId) => {
      return localStorage.getItem(`lifeTracker:draft:page:${pageId}`)
    }, tp.id)
    expect(draft).toBeNull()
  })

  test('Use local version keeps draft content and saves to server', async ({ page }) => {
    const tp = await setupConflict(page)
    test.skip(!tp, 'Could not set up conflict scenario (missing seed section)')

    // Click "Use local version"
    await page.locator('.conflict-modal button', { hasText: 'Use local version' }).click()

    // Modal should disappear
    await expect(page.locator('.conflict-modal')).not.toBeVisible({ timeout: 3000 })

    // Editor should show draft content
    await expect(page.locator('.ProseMirror')).toContainText('STALE DRAFT CONTENT', {
      timeout: 5000,
    })

    // Wait for autosave
    await expect(page.locator('text=Saved')).toBeVisible({ timeout: 10000 })

    // Verify the draft content was saved to the server
    await expect(async () => {
      const { data, error } = await supabaseInfo.client
        .from('pages')
        .select('content')
        .eq('id', tp.id)
        .single()
      if (error) throw error
      const serverText = JSON.stringify(data?.content)
      expect(serverText).toContain('STALE DRAFT CONTENT')
    }).toPass({ timeout: 10000 })
  })
})
