import { test, expect } from './fixtures'
import { getSupabase, createNotebook, createSection, createPage } from './test-helpers'

// Block ID for the internal link target
const TARGET_BLOCK_ID = 'e2e-target-block-copy'
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const exactTreeNode = (page, className, label) =>
  page.locator(className).filter({
    has: page.locator('.tree-label', { hasText: new RegExp(`^${escapeRegex(label)}$`) }),
  }).first()

test.describe('Issue #70 same-notebook section copy', () => {
  let notebookId = null
  let notebookTitle = null
  let testSection = null
  let targetPage = null
  let sectionTitle = null
  let scratchpadTitle = null
  let targetPageTitle = null

  const openPageFromTree = async (page, pageTitle, expectedText) => {
    await page.goto('/')
    await page.waitForSelector('.app:not(.app-auth)', { timeout: 15000 })

    const notebookNode = exactTreeNode(page, '.tree-node-notebook', notebookTitle)
    await expect(notebookNode).toBeVisible({ timeout: 10000 })
    await notebookNode.click()

    const sectionNode = exactTreeNode(page, '.tree-node-section', sectionTitle)
    await expect(sectionNode).toBeVisible({ timeout: 10000 })
    await sectionNode.click()

    const pageNode = exactTreeNode(page, '.tree-node-page', pageTitle)
    await expect(pageNode).toBeVisible({ timeout: 10000 })
    await pageNode.click()

    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })
    await expect(page.locator('.title-input')).toHaveValue(pageTitle, { timeout: 10000 })
    if (expectedText) {
      await expect(page.locator('.ProseMirror')).toContainText(expectedText, { timeout: 10000 })
    }
  }

  test.beforeEach(async () => {
    const { client, userId } = await getSupabase()
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    notebookTitle = `Issue70 Notebook ${unique}`
    sectionTitle = `Test Section ${unique}`
    scratchpadTitle = `Test Scratchpad ${unique}`
    targetPageTitle = `Test Page ${unique}`

    // Create our own notebook and section for isolation
    const nb = await createNotebook(client, userId, notebookTitle)
    notebookId = nb.id
    testSection = await createSection(client, userId, nb.id, sectionTitle, 9999)

    // Create target page first (so we have its ID for the internal link)
    targetPage = await createPage(client, userId, testSection.id, targetPageTitle, {
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
    const linkHref = `#nb=${notebookId}&sec=${testSection.id}&pg=${targetPage.id}&block=${TARGET_BLOCK_ID}`
    await createPage(client, userId, testSection.id, scratchpadTitle, {
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
    await openPageFromTree(page, targetPageTitle, 'Wedding Planning')

    const sectionNode = exactTreeNode(page, '.tree-node-section', sectionTitle)
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
    const copiedSectionNode = exactTreeNode(page, '.tree-node-section', `${sectionTitle} (1)`)
    await expect(copiedSectionNode).toBeVisible({ timeout: 15000 })

  })

  test('copy section remaps internal links to copied pages', async ({ page }) => {
    await openPageFromTree(page, targetPageTitle, 'Wedding Planning')

    const sectionNode = exactTreeNode(page, '.tree-node-section', sectionTitle)
    await expect(sectionNode).toBeVisible({ timeout: 5000 })

    // Navigate to Test Scratchpad and read the original internal link
    await openPageFromTree(page, scratchpadTitle)

    // Read the original internal link href
    const originalLink = page.locator('.ProseMirror a[href*="pg="]').first()
    await expect(originalLink).toBeVisible({ timeout: 5000 })
    const originalHref = await originalLink.getAttribute('href')
    const originalParams = new URLSearchParams(originalHref.slice(1))
    const originalNotebookId = originalParams.get('nb')
    const originalPageId = originalParams.get('pg')
    const originalSectionId = originalParams.get('sec')
    expect(originalPageId).toBeTruthy()
    expect(originalSectionId).toBe(testSection.id)
    expect(originalNotebookId).toBe(notebookId)

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
    const copiedSectionNode = exactTreeNode(page, '.tree-node-section', `${sectionTitle} (1)`)
    await expect(copiedSectionNode).toBeVisible({ timeout: 10000 })
    await copiedSectionNode.click()
    const copiedScratchpad = exactTreeNode(page, '.tree-node-page', scratchpadTitle)
    await expect(copiedScratchpad).toBeVisible({ timeout: 10000 })
    await copiedScratchpad.click()
    await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 10000 })

    const copiedLink = page.locator('.ProseMirror a[href*="pg="]').first()
    await expect(copiedLink).toBeVisible({ timeout: 5000 })
    const copiedHref = await copiedLink.getAttribute('href')
    const copiedParams = new URLSearchParams(copiedHref.slice(1))
    const copiedNotebookId = copiedParams.get('nb')
    const copiedPageId = copiedParams.get('pg')
    const copiedSectionId = copiedParams.get('sec')

    // The link should point to a DIFFERENT page and section than the original
    expect(copiedPageId).toBeTruthy()
    expect(copiedPageId).not.toBe(originalPageId)
    expect(copiedSectionId).toBeTruthy()
    expect(copiedSectionId).not.toBe(originalSectionId)
    expect(copiedNotebookId).toBe(originalNotebookId)

  })
})
