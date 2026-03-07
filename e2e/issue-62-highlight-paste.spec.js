import { test, expect } from '@playwright/test'

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

test.describe('Issue #62 highlight paste regression', () => {
  test('copy/paste + date edit keeps highlight on date token only', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.app:not(.app-auth)', { timeout: 15000 })
    await page.locator('.sidebar-title', { hasText: 'Test Section' }).click()
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

    const baselineState = await readExpenseState(page)
    const baselineSignature = JSON.stringify(baselineState)
    const hasSeedLine = baselineState.some((line) => line.text.includes('Expenses due 2/22'))
    const hasSeedHighlight = baselineState.some(
      (line) => line.text.includes('Expenses due 2/22') && line.marks.includes('2/22'),
    )
    test.skip(!hasSeedLine || !hasSeedHighlight, 'Seed data missing highlighted "Expenses due 2/22" line')

    try {
      const sourceLine = page.locator('.ProseMirror p, .ProseMirror li', { hasText: 'Expenses due 2/22' }).first()
      await sourceLine.click()

      // Mirrors the recorded flow: copy selected scope, duplicate under source line, edit date.
      await page.keyboard.press('End')
      await page.keyboard.press('Shift+Home')
      await page.keyboard.press('ControlOrMeta+c')
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('Enter')
      await page.keyboard.press('ControlOrMeta+v')

      // Replace pasted date 2/22 -> 3/7.
      await page.keyboard.press('Backspace')
      await page.keyboard.press('Backspace')
      await page.keyboard.press('Backspace')
      await page.keyboard.press('Backspace')
      await page.keyboard.type('3/7')

      const stateAfterEdit = await readExpenseState(page)
      const editedLine = stateAfterEdit.find((line) => line.text.includes('Expenses due 3/7')) ?? null
      expect(editedLine).toBeTruthy()
      expect(editedLine.marks).toContain('3/7')
      expect(editedLine.marks).not.toContain('Expenses due 3/7')
    } finally {
      // Cleanup: undo until the document returns to the exact baseline state.
      for (let i = 0; i < 10; i += 1) {
        const current = await readExpenseState(page)
        if (JSON.stringify(current) === baselineSignature) break
        await page.keyboard.press('ControlOrMeta+z')
      }
    }

    const afterCleanup = await readExpenseState(page)
    expect(JSON.stringify(afterCleanup)).toBe(baselineSignature)
  })
})
