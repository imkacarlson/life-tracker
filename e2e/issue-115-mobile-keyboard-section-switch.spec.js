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
const seedLabel = `KB-115-${Date.now()}`

const ensureNavigationVisible = async (page) => {
  const navTree = page.getByRole('tree', { name: 'Notebook navigation' })
  try {
    await navTree.waitFor({ state: 'visible', timeout: 1000 })
    return
  } catch {
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await expect(navTree).toBeVisible()
  }
}

const readEditorInteractionState = async (page) =>
  page.evaluate(() => {
    const root = document.querySelector('.ProseMirror')
    const activeEl = document.activeElement
    const selection = window.getSelection?.()
    const anchorNode = selection?.anchorNode ?? null
    const focusNode = selection?.focusNode ?? null
    const anchorEl =
      anchorNode && anchorNode.nodeType === 1 ? anchorNode : anchorNode?.parentElement ?? null
    const focusEl =
      focusNode && focusNode.nodeType === 1 ? focusNode : focusNode?.parentElement ?? null

    return {
      activeInEditor: Boolean(root && activeEl && root.contains(activeEl)),
      selectionInEditor: Boolean(root && ((anchorEl && root.contains(anchorEl)) || (focusEl && root.contains(focusEl)))),
    }
  })

test.beforeAll(async () => {
  const { client, userId } = await getSupabase()
  const notebook = await createNotebook(client, userId, `${seedLabel} Notebook`)
  const sectionA = await createSection(client, userId, notebook.id, `${seedLabel} Section A`, 0)
  const sectionB = await createSection(client, userId, notebook.id, `${seedLabel} Section B`, 1)
  const pageA = await createPage(client, userId, sectionA.id, `${seedLabel} Page A`, PAGE_A_CONTENT, 0)
  const pageB = await createPage(client, userId, sectionB.id, `${seedLabel} Page B`, PAGE_B_CONTENT, 0)
  seedIds = { notebook, sectionA, sectionB, pageA, pageB }
})

test('switching sections in sidebar does NOT focus the editor', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile-only test')

  // Navigate to Page A
  const hash = `#nb=${seedIds.notebook.id}&sec=${seedIds.sectionA.id}&pg=${seedIds.pageA.id}`
  await waitForApp(page, hash, { expectedText: 'Section A page content' })

  // Ensure navigation is visible regardless of drawer vs persistent sidebar layout.
  await ensureNavigationVisible(page)

  // Tap Section B to switch
  await page.locator('.tree-node-section .tree-label', { hasText: `${seedLabel} Section B` }).click()

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

test('tapping the editor after section switch DOES focus it', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile-only test')

  // Navigate to Page A
  const hash = `#nb=${seedIds.notebook.id}&sec=${seedIds.sectionA.id}&pg=${seedIds.pageA.id}`
  await waitForApp(page, hash, { expectedText: 'Section A page content' })

  // Ensure navigation is visible regardless of drawer vs persistent sidebar layout.
  await ensureNavigationVisible(page)
  await page.locator('.tree-node-section .tree-label', { hasText: `${seedLabel} Section B` }).click()

  // Wait for content to load
  await expect(page.locator('.ProseMirror')).toContainText('Section B page content', {
    timeout: 10000,
  })

  // Wait for the 300ms focus-suppression timer to clear
  await page.waitForTimeout(600)

  // Tap the editor content area
  await page.locator('.ProseMirror').click()

  // Now the editor should be focused
  const interactionState = await readEditorInteractionState(page)
  expect(interactionState.activeInEditor || interactionState.selectionInEditor).toBe(true)
})
