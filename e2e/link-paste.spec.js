import { test, expect } from './fixtures'
import {
  getSupabase,
  createNotebook,
  createSection,
  createPage,
  deleteNotebookById,
  waitForApp,
} from './test-helpers'

// Reported regression: copy/cut + paste of hyperlinked text dropped the link
// while other formatting survived. The deterministic fidelity guard for this
// lives in src/utils/__tests__/clipboardRoundtrip.test.js (serialize -> parse,
// no flaky OS clipboard). This spec documents the real-browser user journey.
//
// fixme: like the other clipboard specs (#62, #67), live ProseMirror clipboard
// simulation is timing-sensitive and flakes in CI on content-hydration races;
// it passes locally. Keep it here as an executable journey reference.
const SEED_CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id: 'p-link-1' },
      content: [
        { type: 'text', text: 'See ' },
        {
          type: 'text',
          marks: [{ type: 'link', attrs: { href: 'https://example.com/ref' } }],
          text: 'the reference',
        },
      ],
    },
    { type: 'paragraph', attrs: { id: 'p-link-2' } },
  ],
}

const readLinks = async (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('.ProseMirror a')).map((a) => ({
      text: a.textContent ?? '',
      href: a.getAttribute('href'),
    })),
  )

test.describe.fixme('Link paste round-trip (reported regression)', () => {
  let notebookId = null
  let testPage = null

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    const notebook = await createNotebook(client, userId, `LinkPaste ${Date.now()}`)
    notebookId = notebook.id
    const section = await createSection(client, userId, notebook.id, 'Link Section')
    testPage = await createPage(client, userId, section.id, 'Link Page', SEED_CONTENT)
  })

  test.afterAll(async () => {
    const { client } = await getSupabase()
    await deleteNotebookById(client, notebookId)
  })

  test('copying hyperlinked text and pasting keeps the link', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop keyboard copy/paste flow (Shift+Home, Ctrl+C/V)')
    await waitForApp(page, `/#pg=${testPage.id}`)
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })
    await expect(page.locator('.ProseMirror')).toContainText('the reference', { timeout: 10000 })

    // Select the whole first line and copy it.
    const sourceLine = page
      .locator('.ProseMirror p', { hasText: 'the reference' })
      .first()
    await sourceLine.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Shift+Home')
    await page.keyboard.press('ControlOrMeta+c')

    // Paste into the empty paragraph below.
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ControlOrMeta+v')

    await expect(async () => {
      const links = await readLinks(page)
      // Both the original and the pasted copy must carry the href.
      const refLinks = links.filter((l) => l.text === 'the reference')
      expect(refLinks.length).toBeGreaterThanOrEqual(2)
      for (const link of refLinks) {
        expect(link.href).toBe('https://example.com/ref')
      }
    }).toPass({ timeout: 5000 })
  })
})
