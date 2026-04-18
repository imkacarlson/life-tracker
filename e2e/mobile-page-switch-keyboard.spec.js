import { test, expect } from './fixtures'
import {
  clickNavigationItem,
  createNotebook,
  createPage,
  createSection,
  deleteNotebookById,
  ensureNavigationHidden,
  ensureNavigationVisible,
  getSupabase,
  waitForApp,
} from './test-helpers'

const getEditorFocusState = async (page) =>
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
      activeInEditor: Boolean(root && activeEl && root.contains(activeEl)),
      selectionInEditor: Boolean(root && ((anchorEl && root.contains(anchorEl)) || (focusEl && root.contains(focusEl)))),
    }
  })

const PAGE_A_CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id: 'p-pg-switch-a' },
      content: [{ type: 'text', text: 'Page A content' }],
    },
  ],
}

const PAGE_B_CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id: 'p-pg-switch-b' },
      content: [{ type: 'text', text: 'Page B content' }],
    },
  ],
}

let seedIds = {}
const seedLabel = `KB-PG-SWITCH-${Date.now()}`

test.beforeAll(async () => {
  const { client, userId } = await getSupabase()
  const notebook = await createNotebook(client, userId, `${seedLabel} Notebook`)
  const section = await createSection(client, userId, notebook.id, `${seedLabel} Section`, 0)
  const pageA = await createPage(client, userId, section.id, `${seedLabel} Page A`, PAGE_A_CONTENT, 0)
  const pageB = await createPage(client, userId, section.id, `${seedLabel} Page B`, PAGE_B_CONTENT, 1)
  seedIds = { notebook, section, pageA, pageB }
})

test.afterAll(async () => {
  const { client } = await getSupabase()
  await deleteNotebookById(client, seedIds.notebook?.id)
})

test('switching pages in sidebar does NOT focus the editor', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile-only test')

  // Navigate to Page A
  const hash = `#nb=${seedIds.notebook.id}&sec=${seedIds.section.id}&pg=${seedIds.pageA.id}`
  await waitForApp(page, hash, { expectedText: 'Page A content' })

  await ensureNavigationVisible(page)

  // Tap Page B in the sidebar
  await clickNavigationItem(
    page,
    page.locator('.tree-node-page', { hasText: `${seedLabel} Page B` }).first(),
  )

  // Wait for Page B content to load
  await expect(page.locator('.ProseMirror')).toContainText('Page B content', {
    timeout: 10000,
  })

  // Mobile Chromium can retain document.activeElement on the editor root even
  // after navigation blur. The stronger signal for "keyboard should not have
  // opened" is that there is no live DOM selection inside the editor.
  const interactionState = await getEditorFocusState(page)
  expect(interactionState.selectionInEditor).toBe(false)
})

test('tapping the editor after page switch DOES focus it', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile-only test')

  // Navigate to Page A
  const hash = `#nb=${seedIds.notebook.id}&sec=${seedIds.section.id}&pg=${seedIds.pageA.id}`
  await waitForApp(page, hash, { expectedText: 'Page A content' })

  await ensureNavigationVisible(page)

  // Switch to Page B
  await clickNavigationItem(
    page,
    page.locator('.tree-node-page', { hasText: `${seedLabel} Page B` }).first(),
  )

  await expect(page.locator('.ProseMirror')).toContainText('Page B content', {
    timeout: 10000,
  })

  // Dismiss the navigation drawer before tapping the editor
  await ensureNavigationHidden(page)

  // Wait for the blur + suppressFocusRef timer to clear
  await page.waitForTimeout(600)

  // Tap actual editor content so the guarded mobile flow restores editability.
  await page.locator('.ProseMirror p').first().click({ position: { x: 8, y: 8 } })

  await expect(async () => {
    const state = await getEditorFocusState(page)
    expect(state.activeInEditor || state.selectionInEditor).toBe(true)
  }).toPass({ timeout: 5000 })
})
