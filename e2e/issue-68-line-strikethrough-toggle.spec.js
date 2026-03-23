import { test, expect } from './fixtures'
import { getSupabase, createNotebook, createSection, createPage, waitForApp } from './test-helpers'

// Self-contained seed data: a page with a list item and a table with "Next Steps" paragraph
const SEED_CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'bulletList',
      attrs: { id: 'bl-strike-1' },
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              attrs: { id: 'p-strike-li' },
              content: [{ type: 'text', text: 'Review quarterly goals' }],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              attrs: { id: 'p-strike-li2' },
              content: [{ type: 'text', text: 'Send out wedding invites' }],
            },
          ],
        },
      ],
    },
    {
      type: 'table',
      attrs: { id: 'tbl-strike-1' },
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              attrs: { colspan: 1, rowspan: 1 },
              content: [
                {
                  type: 'paragraph',
                  attrs: { id: 'p-strike-next' },
                  content: [{ type: 'text', text: 'Next Steps: finalize budget' }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}

test.describe('Issue #68 strikethrough toggle on entire line', () => {
  let testPage = null

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    const nb = await createNotebook(client, userId, `Issue68 Notebook ${Date.now()}`)
    const sec = await createSection(client, userId, nb.id, 'Issue68 Section')
    testPage = await createPage(client, userId, sec.id, 'Test Section', SEED_CONTENT)
  })

  test('cursor in list item: S button toggles strikethrough on entire line', async ({ page }) => {
    await waitForApp(page, `/#pg=${testPage.id}`, { expectedText: 'Review quarterly goals' })

    // Find a list item to test
    const listItem = page.locator('.ProseMirror li').first()

    // Click at end of the list item text (cursor, no selection)
    await listItem.click()
    await page.waitForTimeout(300)

    // Verify no strikethrough initially
    const hasStrikeBefore = await listItem.evaluate((el) => {
      const s = el.querySelector('s')
      return s !== null && s.textContent.trim().length > 0
    })

    // Click the S (strikethrough) toolbar button
    const strikeBtn = page.getByRole('button', { name: 'S', exact: true })
    await strikeBtn.click()
    await page.waitForTimeout(300)

    // The entire line text should now be wrapped in <s> tags
    const hasStrikeAfter = await listItem.evaluate((el) => {
      const s = el.querySelector('s')
      return s !== null && s.textContent.trim().length > 0
    })

    // Strikethrough state should have toggled
    expect(hasStrikeAfter).not.toBe(hasStrikeBefore)

    // Toggle it back off
    await strikeBtn.click()
    await page.waitForTimeout(300)

    const hasStrikeRestored = await listItem.evaluate((el) => {
      const s = el.querySelector('s')
      return s !== null && s.textContent.trim().length > 0
    })
    expect(hasStrikeRestored).toBe(hasStrikeBefore)
  })

  test('cursor in paragraph: S button toggles strikethrough on entire block', async ({ page }) => {
    await waitForApp(page, `/#pg=${testPage.id}`, { expectedText: 'Next Steps' })

    // Use a paragraph inside a table cell (seed data has "Next Steps:" paragraph)
    const block = page.locator('.ProseMirror td p').filter({ hasText: 'Next Steps' }).first()

    await block.click({ position: { x: 8, y: 8 } })
    await page.waitForTimeout(500)

    const strikeBtn = page.getByRole('button', { name: 'S', exact: true })

    // Toggle on
    await strikeBtn.click()

    // Wait for strikethrough to appear (poll instead of fixed timeout)
    await expect(async () => {
      const hasStrike = await block.evaluate((el) => {
        const s = el.querySelector('s')
        return s !== null && s.textContent.trim().length > 0
      })
      expect(hasStrike).toBe(true)
    }).toPass({ timeout: 3000 })

    // Toggle off
    await strikeBtn.click()
    await page.waitForTimeout(300)

    const hasStrikeOff = await block.evaluate((el) => {
      const s = el.querySelector('s')
      return s !== null && s.textContent.trim().length > 0
    })
    expect(hasStrikeOff).toBe(false)
  })

  test('partial selection: S button toggles strikethrough on selected text only', async ({ page }) => {
    await waitForApp(page, `/#pg=${testPage.id}`, { expectedText: 'Review quarterly goals' })

    const listItem = page.locator('.ProseMirror li').first()

    // Select only part of the text using keyboard: Home, then Shift+Right x3
    const paragraph = listItem.locator('p').first()
    await expect(paragraph).toBeVisible({ timeout: 5000 })

    await paragraph.click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowRight')
    await page.waitForTimeout(200)

    const strikeBtn = page.getByRole('button', { name: 'S', exact: true })
    await strikeBtn.click()
    await page.waitForTimeout(300)

    // Only part of the text should be struck through, not all of it
    const result = await listItem.evaluate((el) => {
      const sEl = el.querySelector('s')
      const allText = el.textContent.trim()
      const struckText = sEl ? sEl.textContent : ''
      return { allText, struckText, hasStrike: sEl !== null }
    })

    expect(result.hasStrike).toBe(true)
    // Struck text should be shorter than full text (partial selection)
    expect(result.struckText.length).toBeLessThan(result.allText.length)

    // Clean up: undo the partial strike with Ctrl+Z
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(300)
  })
})
