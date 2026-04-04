import { test, expect } from './fixtures'
import { getSupabase, createNotebook, createSection, createPage, waitForApp } from './test-helpers'

// Block ID for the internal link target
const TARGET_BLOCK_ID = 'e2e-target-block-copy'

test.describe('Issue #70 same-notebook section copy', () => {
  let notebookId = null
  let testSection = null
  let scratchpadPage = null
  let targetPage = null

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()

    // Create our own notebook and section for isolation
    const nb = await createNotebook(client, userId, `Issue70 Notebook ${Date.now()}`)
    notebookId = nb.id
    testSection = await createSection(client, userId, nb.id, 'Test Section', 9999)

    // Create target page first (so we have its ID for the internal link)
    targetPage = await createPage(client, userId, testSection.id, 'Test Page', {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2, id: 'h-copy-top' },
          content: [{ type: 'text', text: 'Wedding Planning' }],
        },
        {
          type: 'paragraph',
          attrs: { id: TARGET_BLOCK_ID },
          content: [{ type: 'text', text: 'Target block for internal link.' }],
        },
      ],
    })

    // Create scratchpad page with an internal link to the target page
    const linkHref = `#pg=${targetPage.id}&block=${TARGET_BLOCK_ID}`
    scratchpadPage = await createPage(client, userId, testSection.id, 'Test Scratchpad', {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: 'p-copy-link' },
          content: [
            { type: 'text', text: 'See ' },
            {
              type: 'text',
              marks: [
                {
                  type: 'link',
                  attrs: { href: linkHref, target: '_self', class: null },
                },
              ],
              text: 'the target',
            },
          ],
        },
      ],
    })
  })

  test('copy section to same notebook creates suffixed duplicate', async ({ page }) => {
    await waitForApp(page, `/#pg=${targetPage.id}`, { expectedText: 'Wedding Planning' })

    const sectionNode = page.locator('.tree-node-section', { hasText: 'Test Section' }).first()
    await expect(sectionNode).toBeVisible({ timeout: 5000 })

    // Right-click the section node to open context menu
    await sectionNode.click({ button: 'right' })
    const copyBtn = page.getByRole('button', { name: 'Copy to…' })
    await expect(copyBtn).toBeVisible({ timeout: 3000 })
    await copyBtn.click()

    // Modal should show — select the current notebook
    const modal = page.locator('.copy-move-modal')
    await expect(modal).toBeVisible({ timeout: 3000 })
    const select = modal.locator('select')

    await select.selectOption(notebookId)

    // Click Copy
    await modal.getByRole('button', { name: 'Copy' }).click()
    await expect(modal).not.toBeVisible({ timeout: 3000 })

    // The copied section should appear with a suffixed name
    const copiedSectionNode = page.locator('.tree-node-section', { hasText: 'Test Section (1)' })
    await expect(copiedSectionNode).toBeVisible({ timeout: 15000 })

  })

  test('copy section remaps internal links to copied pages', async ({ page }) => {
    await waitForApp(page, `/#pg=${targetPage.id}`, { expectedText: 'Wedding Planning' })

    const sectionNode = page.locator('.tree-node-section', { hasText: 'Test Section' }).first()
    await expect(sectionNode).toBeVisible({ timeout: 5000 })

    // Navigate to Test Scratchpad and read the original internal link
    await sectionNode.click()
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })
    const scratchpadPage = page.locator('.tree-node-page', { hasText: 'Test Scratchpad' })
    await expect(scratchpadPage).toBeVisible({ timeout: 3000 })
    await scratchpadPage.click()
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

    // Read the original internal link href
    const originalLink = page.locator('.ProseMirror a[href*="pg="]').first()
    await expect(originalLink).toBeVisible({ timeout: 5000 })
    const originalHref = await originalLink.getAttribute('href')
    const originalParams = new URLSearchParams(originalHref.slice(1))
    const originalPageId = originalParams.get('pg')
    const originalSectionId = originalParams.get('sec')
    expect(originalPageId).toBeTruthy()

    // Copy the section to the same notebook
    await sectionNode.click({ button: 'right' })
    await page.getByRole('button', { name: 'Copy to…' }).click()

    const modal = page.locator('.copy-move-modal')
    await expect(modal).toBeVisible({ timeout: 3000 })
    const select = modal.locator('select')
    await select.selectOption(notebookId)
    await modal.getByRole('button', { name: 'Copy' }).click()
    await expect(modal).not.toBeVisible({ timeout: 3000 })

    // Navigate to the copied section
    const copiedSectionNode = page.locator('.tree-node-section', { hasText: 'Test Section (1)' })
    await expect(copiedSectionNode).toBeVisible({ timeout: 10000 })
    await copiedSectionNode.click()
    const copiedScratchpad = page.locator('.tree-node-page', { hasText: 'Test Scratchpad' })
    await expect(copiedScratchpad).toBeVisible({ timeout: 10000 })
    await copiedScratchpad.click()
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

    const copiedLink = page.locator('.ProseMirror a[href*="pg="]').first()
    await expect(copiedLink).toBeVisible({ timeout: 5000 })
    const copiedHref = await copiedLink.getAttribute('href')
    const copiedParams = new URLSearchParams(copiedHref.slice(1))
    const copiedPageId = copiedParams.get('pg')
    const copiedSectionId = copiedParams.get('sec')

    // The link should point to a DIFFERENT page and section than the original
    expect(copiedPageId).toBeTruthy()
    expect(copiedPageId).not.toBe(originalPageId)
    if (originalSectionId) {
      expect(copiedSectionId).toBeTruthy()
      expect(copiedSectionId).not.toBe(originalSectionId)
    }

  })
})
