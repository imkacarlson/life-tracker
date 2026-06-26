import { test, expect } from './fixtures'
import {
  createNotebook,
  createSection,
  deleteNotebookById,
  getSupabase,
  waitForApp,
} from './test-helpers'

// Regression for: on mobile, dismissing the on-screen keyboard while the find
// bar stays open, then closing the find bar, used to re-open the keyboard.
// Root cause was closeFind() unconditionally re-focusing the editor. The fix
// skips that programmatic focus on touch when the keyboard is not currently up.
//
// In headless Mobile Chrome there is no real on-screen keyboard, so
// isKeyboardShown() reports false — exactly the "user already dismissed the
// keyboard" state this fix targets. We assert the editor does NOT regain focus
// (no live selection / activeElement inside it) after the find bar closes.

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
      selectionInEditor: Boolean(
        root && ((anchorEl && root.contains(anchorEl)) || (focusEl && root.contains(focusEl))),
      ),
    }
  })

let seedIds = {}
const seedLabel = `FIND-CLOSE-${Date.now()}`

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

test('closing the find bar with the keyboard down does NOT refocus the editor', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Mobile-only test')

  const hash = `#nb=${seedIds.notebook.id}&sec=${seedIds.section.id}`
  await waitForApp(page, hash, { waitForEditor: true })

  // Open the find bar (the Find button lives in the always-visible core group).
  await page.getByRole('button', { name: 'Find in page' }).click()

  const findInput = page.locator('.find-input')
  await expect(findInput).toBeVisible({ timeout: 5000 })
  await expect(findInput).toBeFocused()

  // Close the find bar. With the keyboard already down (headless mobile), the
  // editor must not be programmatically refocused.
  await page.getByRole('button', { name: 'Close' }).click()

  await expect(findInput).toHaveCount(0, { timeout: 5000 })

  // No live selection / activeElement inside the editor => the virtual keyboard
  // was not forced back open.
  await expect(async () => {
    const state = await getEditorFocusState(page)
    expect(state.activeInEditor).toBe(false)
    expect(state.selectionInEditor).toBe(false)
  }).toPass({ timeout: 3000 })
})
