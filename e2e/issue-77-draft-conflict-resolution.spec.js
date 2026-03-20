// Regression: Issue #77 — draft conflict resolution
// Found by /investigate + /qa on 2026-03-19
// "Use server version" was not working because:
// 1. activeDraft useMemo was stale after clearing localStorage
// 2. Tiptap editor content was not refreshed after conflict resolution

import { test, expect } from './fixtures'
import { getSupabase, createPage, findFirstSection } from './test-helpers'

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
  let testPage = null
  let sectionId = null

  test.beforeAll(async () => {
    supabaseInfo = await getSupabase()
    sectionId = await findFirstSection(supabaseInfo.client, supabaseInfo.userId).catch(() => null)
  })

  const setupConflict = async (page) => {
    if (!sectionId) return null

    // Create a temporary page with known server content
    testPage = await createPage(
      supabaseInfo.client,
      supabaseInfo.userId,
      sectionId,
      'Conflict Test Page',
      SERVER_CONTENT,
    )

    // Navigate directly to the test page (full page load so loadTrackers
    // picks up the page we just created via the API).
    await page.goto(`/#pg=${testPage.id}`)
    await page.waitForSelector('.app:not(.app-auth)', { timeout: 15000 })
    await page.waitForSelector('.ProseMirror', { timeout: 10000 })

    // Wait for editor to load the server content
    await expect(page.locator('.ProseMirror')).toContainText('Server Version Heading', {
      timeout: 10000,
    })

    // Navigate to a different page (click first page in sidebar that isn't ours)
    const otherPage = page
      .locator('.sidebar-item:not(.active)')
      .first()
    if ((await otherPage.count()) === 0) return null
    await otherPage.click()
    await page.waitForTimeout(500)

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

    // Update server timestamp to be newer than the draft
    await supabaseInfo.client
      .from('pages')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', testPage.id)

    // Navigate back to our test page to trigger conflict detection
    await page.evaluate((pageId) => {
      document.querySelectorAll('.sidebar-item').forEach((el) => {
        if (el.textContent.trim() === 'Conflict Test Page') el.click()
      })
    }, testPage.id)

    // Wait for conflict modal to appear
    await expect(page.locator('.conflict-modal')).toBeVisible({ timeout: 5000 })

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
    const { data } = await supabaseInfo.client
      .from('pages')
      .select('content')
      .eq('id', tp.id)
      .single()
    const serverText = JSON.stringify(data?.content)
    expect(serverText).toContain('STALE DRAFT CONTENT')
  })
})
