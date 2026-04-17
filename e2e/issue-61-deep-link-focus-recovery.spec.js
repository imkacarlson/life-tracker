import { test, expect } from './fixtures'
import {
  clickNavigationItem,
  createNotebook,
  createPage,
  createSection,
  deleteNotebookById,
  getSupabase,
  waitForApp,
} from './test-helpers'

// Block ID that will be used as the deep-link target
const TARGET_BLOCK_ID = 'e2e-target-block-focus'

const getSelectionState = async (page) =>
  page.evaluate(() => {
    const root = document.querySelector('.ProseMirror')
    const selection = window.getSelection?.()
    const anchorNode = selection?.anchorNode ?? null
    const focusNode = selection?.focusNode ?? null
    const anchorEl =
      anchorNode && anchorNode.nodeType === 1 ? anchorNode : anchorNode?.parentElement ?? null
    const focusEl =
      focusNode && focusNode.nodeType === 1 ? focusNode : focusNode?.parentElement ?? null
    const activeEl = document.activeElement

    return {
      activeTag: activeEl?.tagName ?? null,
      activeInEditor: Boolean(root && activeEl && root.contains(activeEl)),
      selectionInEditor: Boolean(root && ((anchorEl && root.contains(anchorEl)) || (focusEl && root.contains(focusEl)))),
      selectedText: selection?.toString() ?? '',
    }
  })

test.describe('Issue #61 deep-link focus recovery', () => {
  let notebookId = null
  let pageA = null // Page with internal link
  let pageB = null // Target page with block ID
  let linkHref = null

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    const nb = await createNotebook(client, userId, `Issue61 Notebook ${Date.now()}`)
    notebookId = nb.id
    const sec = await createSection(client, userId, nb.id, 'Issue61 Section')
    const sectionId = sec.id

    // Create target page (Page B) first
    pageB = await createPage(client, userId, sectionId, 'Test Section', {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2, id: 'h-focus-top' },
          content: [{ type: 'text', text: 'Focus Recovery Test' }],
        },
        {
          type: 'paragraph',
          attrs: { id: TARGET_BLOCK_ID },
          content: [{ type: 'text', text: 'This is the deep link target for focus tests.' }],
        },
        {
          type: 'paragraph',
          attrs: { id: 'p-focus-extra' },
          content: [{ type: 'text', text: 'Extra content below target.' }],
        },
      ],
    })

    // Build the internal link href
    linkHref = `#pg=${pageB.id}&block=${TARGET_BLOCK_ID}`

    // Create source page (Page A) with internal link
    pageA = await createPage(client, userId, sectionId, 'Test Scratchpad', {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: 'p-focus-link' },
          content: [
            { type: 'text', text: 'Link to ' },
            {
              type: 'text',
              marks: [
                {
                  type: 'link',
                  attrs: { href: linkHref, target: '_self', class: null },
                },
              ],
              text: 'target block',
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

  const resolveDeepLinkTarget = async (page) => {
    await clickNavigationItem(page, page.locator('.tree-node-page', { hasText: 'Test Scratchpad' }).first())
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 5000 })

    const internalLink = page.locator('.ProseMirror a[href*="pg="]').first()
    await expect(internalLink).toBeVisible({ timeout: 10000 })
    const href = await internalLink.getAttribute('href')
    const blockId = href ? new URL('http://x/' + href.replace('#', '?')).searchParams.get('block') : null
    expect(blockId).toBeTruthy()

    await clickNavigationItem(page, page.locator('.tree-node-page', { hasText: 'Test Section' }).first())
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 5000 })
    await page.evaluate((targetHref) => {
      window.location.hash = targetHref
    }, href)

    const styleLocator = page.locator('#deep-link-target-style')
    await expect(async () => {
      const content = await styleLocator.textContent()
      expect(content).toContain(blockId)
    }).toPass({ timeout: 10000 })

    return { blockId, styleLocator }
  }

  test.beforeEach(async ({ page }) => {
    // Navigate to Page A so the correct notebook/section is active
    await waitForApp(page, `/#pg=${pageA.id}`, { expectedText: 'Link to' })
  })

  test('desktop: first click-back after highlight clear keeps keyboard scope in editor', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop keyboard shortcut regression path')

    const { blockId, styleLocator } = await resolveDeepLinkTarget(page)

    await page.locator('.slim-header').click({ position: { x: 12, y: 12 } })
    await expect(async () => {
      const content = await styleLocator.textContent()
      expect(content?.trim() || '').toBe('')
    }).toPass({ timeout: 5000 })

    const targetBlock = page.locator(`[id="${blockId}"]`)
    await expect(targetBlock).toBeVisible({ timeout: 5000 })
    const box = await targetBlock.boundingBox()
    expect(box).toBeTruthy()

    // Click near the left edge so this is not dependent on clicking exact text glyphs.
    await page.mouse.click(box.x + 4, box.y + Math.max(4, Math.min(box.height - 4, box.height / 2)))
    await page.keyboard.press('ControlOrMeta+a')

    const selectionState = await getSelectionState(page)
    expect(selectionState.activeTag).not.toBe('BODY')
    expect(selectionState.activeInEditor || selectionState.selectionInEditor).toBeTruthy()
    expect(selectionState.selectedText.length).toBeGreaterThan(0)
    expect(selectionState.selectedText).not.toContain('Life Tracker')
    expect(selectionState.selectedText).not.toContain('Signed in as')
  })

  test('mobile: deep-link landing avoids auto-focus and still supports tap-back editing flow', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Mobile guard regression path')

    const { blockId, styleLocator } = await resolveDeepLinkTarget(page)
    const initialState = await getSelectionState(page)
    expect(initialState.activeInEditor).toBeFalsy()

    await page.locator('.slim-header').click({ position: { x: 12, y: 12 } })
    await expect(async () => {
      const content = await styleLocator.textContent()
      expect(content?.trim() || '').toBe('')
    }).toPass({ timeout: 5000 })

    const targetBlock = page.locator(`[id="${blockId}"]`)
    await expect(targetBlock).toBeVisible({ timeout: 5000 })
    await targetBlock.click({ position: { x: 8, y: 8 } })

    const stateAfterTapBack = await getSelectionState(page)
    expect(stateAfterTapBack.activeInEditor || stateAfterTapBack.selectionInEditor).toBeTruthy()
  })
})
