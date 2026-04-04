import { test, expect } from './fixtures'
import { getSupabase, createNotebook, createSection, createPage, waitForApp } from './test-helpers'

const PAGE_A_CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id: 'p-115-a' },
      content: [{ type: 'text', text: 'Section A page content' }],
    },
  ],
}

const PAGE_B_CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id: 'p-115-b' },
      content: [{ type: 'text', text: 'Section B page content' }],
    },
  ],
}

let seedIds = {}

test.beforeAll(async () => {
  const { client, userId } = await getSupabase()
  const notebook = await createNotebook(client, userId, 'KB-115 Notebook')
  const sectionA = await createSection(client, userId, notebook.id, 'Section A', 0)
  const sectionB = await createSection(client, userId, notebook.id, 'Section B', 1)
  const pageA = await createPage(client, userId, sectionA.id, 'Page A', PAGE_A_CONTENT, 0)
  const pageB = await createPage(client, userId, sectionB.id, 'Page B', PAGE_B_CONTENT, 0)
  seedIds = { notebook, sectionA, sectionB, pageA, pageB }
})

// This test only applies to mobile — skip on desktop.
test.skip(({ browserName }, testInfo) => testInfo.project.name === 'Desktop Chrome', 'Mobile-only test')

test('switching sections in sidebar does NOT focus the editor', async ({ page }) => {
  // Navigate to Page A
  const hash = `#nb=${seedIds.notebook.id}&sec=${seedIds.sectionA.id}&pg=${seedIds.pageA.id}`
  await waitForApp(page, hash, { expectedText: 'Section A page content' })

  // Open mobile sidebar
  await page.locator('button[aria-label="Open navigation"]').click()
  await expect(page.locator('.nav-tree-container.open')).toBeVisible()

  // Tap Section B to switch
  await page.locator('.tree-node-section .tree-label', { hasText: 'Section B' }).click()

  // Wait for content to load
  await expect(page.locator('.ProseMirror')).toContainText('Section B page content', {
    timeout: 10000,
  })

  // The editor should NOT be focused — keyboard should not have opened.
  // On mobile, after a section switch the ProseMirror element should not
  // have focus (which is what triggers the virtual keyboard).
  const isFocused = await page.evaluate(() => {
    const pm = document.querySelector('.ProseMirror')
    return pm === document.activeElement || (pm && pm.contains(document.activeElement))
  })
  expect(isFocused).toBe(false)
})

test('tapping the editor after section switch DOES focus it', async ({ page }) => {
  // Navigate to Page A
  const hash = `#nb=${seedIds.notebook.id}&sec=${seedIds.sectionA.id}&pg=${seedIds.pageA.id}`
  await waitForApp(page, hash, { expectedText: 'Section A page content' })

  // Open mobile sidebar and switch to Section B
  await page.locator('button[aria-label="Open navigation"]').click()
  await expect(page.locator('.nav-tree-container.open')).toBeVisible()
  await page.locator('.tree-node-section .tree-label', { hasText: 'Section B' }).click()

  // Wait for content to load
  await expect(page.locator('.ProseMirror')).toContainText('Section B page content', {
    timeout: 10000,
  })

  // Wait for suppression to clear
  await page.waitForTimeout(500)

  // Tap the editor content area
  await page.locator('.ProseMirror').click()

  // Now the editor should be focused
  const isFocused = await page.evaluate(() => {
    const pm = document.querySelector('.ProseMirror')
    return pm === document.activeElement || (pm && pm.contains(document.activeElement))
  })
  expect(isFocused).toBe(true)
})
