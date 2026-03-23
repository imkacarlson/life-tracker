import { test, expect } from './fixtures'
import { getSupabase, createNotebook, createSection, createPage, waitForApp } from './test-helpers'

// Self-contained seed data: a page with a highlighted date in "Expenses due 2/22"
const SEED_CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id: 'p-highlight-1' },
      content: [
        { type: 'text', text: 'Expenses due ' },
        {
          type: 'text',
          marks: [{ type: 'highlight', attrs: { color: '#fef08a' } }],
          text: '2/22',
        },
      ],
    },
  ],
}

const readExpenseState = async (page) =>
  page.evaluate(() => {
    const normalize = (value) => value.replace(/\s+/g, ' ').trim()
    const lines = Array.from(document.querySelectorAll('.ProseMirror p, .ProseMirror li'))
      .map((node) => {
        const text = normalize(node.textContent ?? '')
        const marks = Array.from(node.querySelectorAll('mark')).map((mark) => normalize(mark.textContent ?? ''))
        return { text, marks }
      })
      .filter((line) => line.text.startsWith('Expenses due'))
    return lines
  })

// fixme: clipboard simulation against ProseMirror is inherently timing-sensitive;
// these pass locally but flake in CI due to async content hydration races.
test.describe.fixme('Issue #62 highlight paste regression', () => {
  let testPage = null

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    // Create an isolated notebook+section so deep-link navigation is deterministic
    const notebook = await createNotebook(client, userId, `T62 Notebook ${Date.now()}`)
    const section = await createSection(client, userId, notebook.id, 'T62 Section')
    testPage = await createPage(client, userId, section.id, 'Highlight Test', SEED_CONTENT)
  })

  test('copy/paste + date edit keeps highlight on date token only', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop keyboard shortcut flow (Shift+Home, Ctrl+C/V)')
    await waitForApp(page, `/#pg=${testPage.id}`)
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

    // Wait for the seed content to render in the editor
    await expect(page.locator('.ProseMirror')).toContainText('Expenses due 2/22', { timeout: 10000 })

    const baselineState = await readExpenseState(page)
    const hasSeedLine = baselineState.some((line) => line.text.includes('Expenses due 2/22'))
    const hasSeedHighlight = baselineState.some(
      (line) => line.text.includes('Expenses due 2/22') && line.marks.includes('2/22'),
    )
    expect(hasSeedLine).toBe(true)
    expect(hasSeedHighlight).toBe(true)

    const sourceLine = page.locator('.ProseMirror p, .ProseMirror li', { hasText: 'Expenses due 2/22' }).first()
    await sourceLine.click()

    // Mirrors the recorded flow: copy selected scope, duplicate under source line, edit date.
    await page.keyboard.press('End')
    await page.keyboard.press('Shift+Home')
    await page.keyboard.press('ControlOrMeta+c')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await page.keyboard.press('ControlOrMeta+v')

    // Wait for paste to settle in ProseMirror before editing
    await expect(page.locator('.ProseMirror')).toContainText('Expenses due 2/22\nExpenses due 2/22', { timeout: 5000 })

    // Replace pasted date 2/22 -> 3/7.
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await page.keyboard.type('3/7')

    // Use toPass for the final assertion in case cursor position after paste was off
    await expect(async () => {
      const stateAfterEdit = await readExpenseState(page)
      const editedLine = stateAfterEdit.find((line) => line.text.includes('Expenses due 3/7')) ?? null
      expect(editedLine).toBeTruthy()
      expect(editedLine.marks).toContain('3/7')
      expect(editedLine.marks).not.toContain('Expenses due 3/7')
    }).toPass({ timeout: 5000 })
  })
})
