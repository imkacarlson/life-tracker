import { test, expect } from './fixtures'
import {
  createNotebook,
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

let seedIds = {}
const seedLabel = `KB-NEW-PAGE-${Date.now()}`

test.beforeAll(async () => {
  const { client, userId } = await getSupabase()
  const notebook = await createNotebook(client, userId, `${seedLabel} Notebook`)
  const section = await createSection(client, userId, notebook.id, `${seedLabel} Section`, 0)
  seedIds = { notebook, section }
})

test.afterAll(async () => {
  const { client } = await getSupabase()
  await deleteNotebookById(client, seedIds.notebook?.id)
})

const createNewPage = async (page) => {
  await ensureNavigationVisible(page)
  await page.getByRole('button', { name: '+ New page' }).click()
}

test('creating a new page collapses the drawer and shows a blank page', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile-only test')

  const hash = `#nb=${seedIds.notebook.id}&sec=${seedIds.section.id}`
  await waitForApp(page, hash, { waitForEditor: false })

  await createNewPage(page)

  // Drawer should collapse so the new page is not hidden behind it.
  await expect(page.locator('.nav-tree-container.open')).toHaveCount(0, { timeout: 5000 })

  // The freshly created page shows an empty editor.
  const editor = page.locator('.ProseMirror')
  await expect(editor).toBeVisible({ timeout: 10000 })
  await expect(editor).toHaveText('')
})

test('creating a new page does NOT open the keyboard', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile-only test')

  const hash = `#nb=${seedIds.notebook.id}&sec=${seedIds.section.id}`
  await waitForApp(page, hash, { waitForEditor: false })

  await createNewPage(page)

  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 10000 })

  // Same signal as the page-switch test: no live DOM selection inside the
  // editor means the virtual keyboard was not auto-opened.
  const interactionState = await getEditorFocusState(page)
  expect(interactionState.selectionInEditor).toBe(false)
})

test('tapping the editor after creating a new page DOES focus it', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile-only test')

  const hash = `#nb=${seedIds.notebook.id}&sec=${seedIds.section.id}`
  await waitForApp(page, hash, { waitForEditor: false })

  await createNewPage(page)

  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 10000 })

  // Drawer is already closed by the create flow; ensure it stays hidden.
  await ensureNavigationHidden(page)

  // Wait for the blur + suppressFocusRef timer to clear.
  await page.waitForTimeout(600)

  // Tap actual editor content so the guarded mobile flow restores editability.
  await page.locator('.ProseMirror p').first().click({ position: { x: 8, y: 8 } })

  await expect(async () => {
    const state = await getEditorFocusState(page)
    expect(state.activeInEditor || state.selectionInEditor).toBe(true)
  }).toPass({ timeout: 5000 })
})
