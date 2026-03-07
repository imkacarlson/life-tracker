import { test, expect } from './fixtures'

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

const resolveDeepLinkTarget = async (page) => {
  await page.locator('.sidebar-title', { hasText: 'Test Scratchpad' }).click()
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 5000 })

  const internalLink = page.locator('.ProseMirror a[href*="pg="]').first()
  await expect(internalLink).toBeVisible({ timeout: 10000 })
  const href = await internalLink.getAttribute('href')
  const blockId = href ? new URL('http://x/' + href.replace('#', '?')).searchParams.get('block') : null
  test.skip(!href || !blockId, 'Seed data missing deep-link href with block id')

  await page.locator('.sidebar-title', { hasText: 'Test Section' }).click()
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

test.describe('Issue #61 deep-link focus recovery', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.app:not(.app-auth)', { timeout: 10000 })
  })

  test('desktop: first click-back after highlight clear keeps keyboard scope in editor', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop keyboard shortcut regression path')

    const { blockId, styleLocator } = await resolveDeepLinkTarget(page)

    await page.locator('.topbar').click({ position: { x: 12, y: 12 } })
    await expect(async () => {
      const content = await styleLocator.textContent()
      expect(content?.trim() || '').toBe('')
    }).toPass({ timeout: 5000 })

    const targetBlock = page.locator(`[id="${blockId}"]`)
    await expect(targetBlock).toBeVisible({ timeout: 5000 })
    const box = await targetBlock.boundingBox()
    test.skip(!box, 'Deep-link target block is not clickable')

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

    await page.locator('.topbar').click({ position: { x: 12, y: 12 } })
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
