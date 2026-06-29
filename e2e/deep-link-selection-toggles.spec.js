import { test, expect } from './fixtures'
import {
  clickNavigationItem,
  createNotebook,
  createPage,
  createSection,
  deleteNotebookById,
  ensureToolbarExpanded,
  getSupabase,
  waitForApp,
} from './test-helpers'

// The deep-link landing should arm the target block as a real text selection so
// every toolbar toggle acts on the whole line — while showing only the yellow
// box (no native blue) and, on touch, without opening the keyboard.
const TARGET_BLOCK_ID = 'e2e-deeplink-armed-target'
const TARGET_TEXT = 'Arm this whole line as a selection'
const OTHER_BLOCK_ID = 'e2e-deeplink-other'
const OTHER_TEXT = 'A different paragraph to click into'

const ARMED_CLASS = 'deep-link-selection-active'

// Whole-line mark coverage: the given tag wraps the entire block text.
const wholeLineMark = (locator, tag) =>
  locator.evaluate((el, t) => {
    const marked = el.querySelector(t)
    const all = el.textContent.trim()
    return Boolean(marked) && marked.textContent.trim() === all && all.length > 0
  }, tag)

test.describe('deep-link landing arms a real selection for toolbar toggles', () => {
  let notebookId = null
  let pageA = null // source page with the internal link
  let pageB = null // target page with the anchored block
  let linkHref = null

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    const nb = await createNotebook(client, userId, `DeepLinkSel Notebook ${Date.now()}`)
    notebookId = nb.id
    const sec = await createSection(client, userId, nb.id, 'DeepLinkSel Section')

    pageB = await createPage(client, userId, sec.id, 'Target Page', {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2, id: 'h-deeplink-top' },
          content: [{ type: 'text', text: 'Deep Link Selection Test' }],
        },
        {
          type: 'paragraph',
          attrs: { id: TARGET_BLOCK_ID },
          content: [{ type: 'text', text: TARGET_TEXT }],
        },
        {
          type: 'paragraph',
          attrs: { id: OTHER_BLOCK_ID },
          content: [{ type: 'text', text: OTHER_TEXT }],
        },
      ],
    })

    linkHref = `#pg=${pageB.id}&block=${TARGET_BLOCK_ID}`

    pageA = await createPage(client, userId, sec.id, 'Source Page', {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: 'p-deeplink-link' },
          content: [
            { type: 'text', text: 'Jump to ' },
            {
              type: 'text',
              marks: [{ type: 'link', attrs: { href: linkHref, target: '_self', class: null } }],
              text: 'the target',
            },
          ],
        },
      ],
    })
  })

  test.afterAll(async () => {
    const { client } = await getSupabase()
    await deleteNotebookById(client, notebookId)
  })

  // Land on the target block via the internal link, the same way a user would.
  const landOnTarget = async (page) => {
    await clickNavigationItem(
      page,
      page.locator('.tree-node-page', { hasText: 'Source Page' }).first(),
    )
    await expect(page.locator('.ProseMirror')).toContainText('Jump to', { timeout: 10000 })

    const internalLink = page.locator('.ProseMirror a[href*="pg="]').first()
    await expect(internalLink).toBeVisible({ timeout: 10000 })
    await internalLink.click()

    const targetBlock = page.locator(`[id="${TARGET_BLOCK_ID}"]`)
    await expect(targetBlock).toBeVisible({ timeout: 10000 })
    await expect(targetBlock).toContainText(TARGET_TEXT, { timeout: 10000 })
    return targetBlock
  }

  test.beforeEach(async ({ page }) => {
    await waitForApp(page, `/#pg=${pageA.id}`, { expectedText: 'Jump to' })
  })

  test('lands with yellow box + armed selection (blue hidden), toggles whole line', async ({
    page,
  }) => {
    const targetBlock = await landOnTarget(page)

    // (a) Yellow box is shown and the armed class is on the ProseMirror root, which
    // is what hides the native blue ::selection while the line stays "selected".
    await expect(async () => {
      const highlighted = await targetBlock.evaluate((el) => {
        const hasClass = el.classList.contains('deep-link-target')
        const styleNode = document.getElementById('deep-link-target-style')
        const styleTargetsBlock = styleNode?.textContent?.includes(`[id="${el.id}"]`) ?? false
        return hasClass || styleTargetsBlock
      })
      expect(highlighted).toBe(true)
    }).toPass({ timeout: 5000 })
    await expect(async () => {
      const armed = await page.evaluate(
        (cls) => document.querySelector('.ProseMirror')?.classList.contains(cls) ?? false,
        ARMED_CLASS,
      )
      expect(armed).toBe(true)
    }).toPass({ timeout: 5000 })

    // (b) Strikethrough acts on the whole landed line, not a collapsed caret.
    await ensureToolbarExpanded(page)
    await page.getByTestId('toolbar-strikethrough').click()
    await expect(async () => {
      expect(await wholeLineMark(targetBlock, 's')).toBe(true)
    }).toPass({ timeout: 3000 })

    // (c) The armed selection survives the toolbar tap, so a second toggle (Bold)
    // also applies to the whole line.
    await expect(async () => {
      const stillArmed = await page.evaluate(
        (cls) => document.querySelector('.ProseMirror')?.classList.contains(cls) ?? false,
        ARMED_CLASS,
      )
      expect(stillArmed).toBe(true)
    }).toPass({ timeout: 3000 })

    await ensureToolbarExpanded(page)
    await page.getByRole('button', { name: 'Bold' }).click()
    await expect(async () => {
      expect(await wholeLineMark(targetBlock, 'strong')).toBe(true)
    }).toPass({ timeout: 3000 })

    // Clean up the marks so the shared page is left as seeded.
    await ensureToolbarExpanded(page)
    await page.getByRole('button', { name: 'Bold' }).click()
    await ensureToolbarExpanded(page)
    await page.getByTestId('toolbar-strikethrough').click()
  })

  test('clicking elsewhere in the doc clears the yellow + armed state', async ({ page }) => {
    await landOnTarget(page)

    const otherBlock = page.locator(`[id="${OTHER_BLOCK_ID}"]`)
    await expect(otherBlock).toBeVisible({ timeout: 5000 })
    await otherBlock.click({ position: { x: 8, y: 8 } })

    await expect(async () => {
      const cleared = await page.evaluate((cls) => {
        const root = document.querySelector('.ProseMirror')
        const armed = root?.classList.contains(cls) ?? false
        const hasYellow = document.querySelector('.deep-link-target') != null
        return !armed && !hasYellow
      }, ARMED_CLASS)
      expect(cleared).toBe(true)
    }).toPass({ timeout: 5000 })
  })
})
