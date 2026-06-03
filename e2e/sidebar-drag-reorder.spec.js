/**
 * Sidebar drag-and-drop reordering (pages within a section).
 *
 * Drag is keyboard-driven here because keyboard reordering is deterministic in
 * Playwright and exercises the same dnd-kit `onDragEnd` path as pointer/touch:
 * focus a row's drag handle, Space to lift, ArrowDown/ArrowUp to move, Space to
 * drop. Then assert the new order persists after a reload.
 */
import { test, expect } from './fixtures'
import {
  createNotebook,
  createPage,
  createSection,
  deleteNotebookById,
  ensureNavigationVisible,
  getSupabase,
  waitForApp,
} from './test-helpers'

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] }

test.describe('sidebar drag-and-drop reorder', () => {
  let notebook = null
  let section = null
  let page1 = null
  let page2 = null
  let page3 = null
  let supabaseClient = null

  test.beforeAll(async () => {
    const { client, userId } = await getSupabase()
    supabaseClient = client
    const stamp = Date.now()
    notebook = await createNotebook(client, userId, `Reorder NB ${stamp}`, -8700)
    section = await createSection(client, userId, notebook.id, `Reorder Sec ${stamp}`, 0)
    page1 = await createPage(client, userId, section.id, `DnD Page 1 ${stamp}`, EMPTY_DOC, 0)
    page2 = await createPage(client, userId, section.id, `DnD Page 2 ${stamp}`, EMPTY_DOC, 1)
    page3 = await createPage(client, userId, section.id, `DnD Page 3 ${stamp}`, EMPTY_DOC, 2)
  })

  test.afterAll(async () => {
    const { client } = await getSupabase()
    await deleteNotebookById(client, notebook?.id)
  })

  // Read the visible order of this section's pages from the sidebar DOM.
  const readPageOrder = async (page) => {
    const labels = await page.locator('.tree-node-page .tree-label').allTextContents()
    return labels
      .map((label) => label.trim())
      .filter((label) => label.startsWith('DnD Page'))
  }

  const readPersistedPageOrder = async () => {
    const { data, error } = await supabaseClient
      .from('pages')
      .select('title')
      .eq('section_id', section.id)
      .order('sort_order', { ascending: true, nullsLast: true })
      .order('updated_at', { ascending: false })

    if (error) throw error
    return (data ?? []).map((row) => row.title)
  }

  test('reordering a page via keyboard persists after reload', async ({ page }) => {
    const hash = `#nb=${notebook.id}&sec=${section.id}&pg=${page1.id}`
    await waitForApp(page, hash)
    await ensureNavigationVisible(page)

    // Pages start in creation order.
    await expect.poll(() => readPageOrder(page)).toEqual([
      page1.title,
      page2.title,
      page3.title,
    ])

    // Move the first page down one slot via the focused keyboard handle.
    const handle = page.getByRole('button', { name: `Reorder page ${page1.title}` })
    await expect(handle).toBeAttached()
    await handle.scrollIntoViewIfNeeded()
    await handle.focus()
    await page.keyboard.press('ArrowDown') // move below page 2
    await expect.poll(() => readPageOrder(page), { timeout: 15000 }).toEqual([
      page2.title,
      page1.title,
      page3.title,
    ])

    await expect.poll(() => readPersistedPageOrder(), { timeout: 15000 }).toEqual([
      page2.title,
      page1.title,
      page3.title,
    ])

    // The new order survives a reload (persisted to Supabase).
    await page.reload()
    await ensureNavigationVisible(page)
    await expect.poll(() => readPageOrder(page), { timeout: 15000 }).toEqual([
      page2.title,
      page1.title,
      page3.title,
    ])
  })
})
