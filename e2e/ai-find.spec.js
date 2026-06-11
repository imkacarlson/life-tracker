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
