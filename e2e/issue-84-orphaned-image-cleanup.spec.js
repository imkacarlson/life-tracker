import { test, expect } from './fixtures'
import { getSupabase, createNotebook, createSection, createPage, waitForApp } from './test-helpers'

const BUCKET = 'tracker-images'

// Helper: upload a tiny 1x1 PNG to storage and return the storage path.
const uploadTestImage = async (client, userId, fileName) => {
  // Minimal valid 1x1 transparent PNG (67 bytes)
  const pngBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02,
    0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ])
  const storagePath = `${userId}/${fileName}`
  const { error } = await client.storage
    .from(BUCKET)
    .upload(storagePath, pngBytes, { contentType: 'image/png', upsert: true })
  if (error) throw error
  return storagePath
}

// Helper: check if a file exists in storage.
const storageFileExists = async (client, storagePath) => {
  // createSignedUrl succeeds only if the file exists.
  const { data, error } = await client.storage.from(BUCKET).createSignedUrl(storagePath, 60)
  return !error && !!data?.signedUrl
}

// Helper: clean up a storage file (best-effort).
const cleanupStorageFile = async (client, storagePath) => {
  await client.storage.from(BUCKET).remove([storagePath]).catch(() => {})
}

// Helper: poll until a storage file is gone (or timeout).
// The app's image cleanup is fire-and-forget, so we need to wait for
// the async deletion to propagate through Supabase.
const waitForStorageFileDeletion = async (client, storagePath, timeoutMs = 30000) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (!(await storageFileExists(client, storagePath))) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

const waitForStorageFileExistence = async (client, storagePath, timeoutMs = 10000) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await storageFileExists(client, storagePath)) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

const waitForPageContent = async (client, pageId, predicate, timeoutMs = 10000) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const { data, error } = await client
      .from('pages')
      .select('content')
      .eq('id', pageId)
      .single()
    if (error) throw error
    if (predicate(data?.content)) return data?.content
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`Timed out waiting for page ${pageId} content to match predicate`)
}

const waitForPageDeletion = async (client, pageId, timeoutMs = 10000) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const { data, error } = await client.from('pages').select('id').eq('id', pageId).maybeSingle()
    if (error) throw error
    if (!data) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

const placeCaretAtEndOfFirstParagraph = async (page) => {
  const paragraph = page.locator('.ProseMirror p', { hasText: 'Some text before the image.' }).first()
  await expect(paragraph).toBeVisible({ timeout: 10000 })

  const box = await paragraph.boundingBox()
  if (!box) {
    throw new Error('Could not find editor paragraph box for caret placement')
  }

  await paragraph.click({
    position: {
      x: Math.max(4, box.width - 6),
      y: box.height / 2,
    },
  })
}

// Minimal 1x1 transparent PNG as a data URI so the <img> renders immediately
// without waiting for Supabase Storage signed-URL hydration.
const TINY_PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg=='

// Build Tiptap JSON with an image node referencing a storage path.
// Uses a data URI src so the image is visible instantly in the editor,
// while storagePath tracks the real file for cleanup logic.
const docWithImage = (storagePath, blockId = 'img-block') => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id: blockId },
      content: [{ type: 'text', text: 'Some text before the image.' }],
    },
    {
      type: 'image',
      attrs: { src: TINY_PNG_DATA_URI, alt: 'test image', storagePath },
    },
  ],
})

// Build Tiptap JSON with just text (no images).
const docWithoutImage = (blockId = 'text-block') => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id: blockId },
      content: [{ type: 'text', text: 'Just text, no images.' }],
    },
  ],
})

// These tests poll Supabase Storage for fire-and-forget cleanup results,
// so they need a generous per-test timeout.
test.describe('Issue #84 orphaned image cleanup', () => {
  test.describe.configure({ timeout: 60000 })
  // ---------- T1: Save with image removed → storage file deleted ----------
  test('T1: removing an image from a page cleans up storage after save', async ({ page }) => {
    const { client, userId } = await getSupabase()
    const storagePath = await uploadTestImage(client, userId, `t1-${Date.now()}.png`)

    // Verify file was uploaded
    expect(await storageFileExists(client, storagePath)).toBe(true)

    // Create test data: notebook → section → page with image
    const nb = await createNotebook(client, userId, `T1 Notebook ${Date.now()}`)
    const sec = await createSection(client, userId, nb.id, 'T1 Section')
    const pg = await createPage(client, userId, sec.id, 'T1 Page', docWithImage(storagePath))

    try {
      // Navigate directly to the test page via hash
      await waitForApp(page, `/#pg=${pg.id}`)
      await page.waitForSelector('.tiptap', { timeout: 10000 })

      // Find and delete the image from the editor
      const img = page.locator('.tiptap img')
      await expect(img).toBeVisible({ timeout: 10000 })
      await img.click()
      await page.keyboard.press('Backspace')

      // Wait for auto-save (2s debounce) + fire-and-forget storage cleanup
      const deleted = await waitForStorageFileDeletion(client, storagePath)
      expect(deleted).toBe(true)
    } finally {
      await cleanupStorageFile(client, storagePath)
    }
  })

  // ---------- T2: Save with no image changes → no storage calls ----------
  test('T2: editing text on a page with images does not delete them', async ({ page }) => {
    const { client, userId } = await getSupabase()
    const storagePath = await uploadTestImage(client, userId, `t2-${Date.now()}.png`)

    const nb = await createNotebook(client, userId, `T2 Notebook ${Date.now()}`)
    const sec = await createSection(client, userId, nb.id, 'T2 Section')
    const pg = await createPage(client, userId, sec.id, 'T2 Page', docWithImage(storagePath))

    try {
      // Navigate directly to the test page via hash
      await waitForApp(page, `/#pg=${pg.id}`)
      await page.waitForSelector('.tiptap', { timeout: 10000 })

      // Place the caret inside the existing paragraph, then type.
      // Clicking the generic editor container on mobile can miss the text cursor entirely.
      await placeCaretAtEndOfFirstParagraph(page)
      await page.keyboard.type(' extra text')
      await expect(page.locator('.ProseMirror')).toContainText('Some text before the image. extra text')

      // Wait for auto-save to persist the typed text before checking storage
      await waitForPageContent(client, pg.id, (content) => JSON.stringify(content).includes('extra text'))

      // Image should still exist after the text-only save finishes propagating.
      const exists = await waitForStorageFileExistence(client, storagePath, 10000)
      expect(exists).toBe(true)
    } finally {
      await cleanupStorageFile(client, storagePath)
    }
  })

  // ---------- T3: Undo image removal before save → file NOT deleted ----------
  test('T3: undoing image removal before save preserves the storage file', async ({ page }) => {
    const { client, userId } = await getSupabase()
    const storagePath = await uploadTestImage(client, userId, `t3-${Date.now()}.png`)

    const nb = await createNotebook(client, userId, `T3 Notebook ${Date.now()}`)
    const sec = await createSection(client, userId, nb.id, 'T3 Section')
    const pg = await createPage(client, userId, sec.id, 'T3 Page', docWithImage(storagePath))

    try {
      // Navigate directly to the test page via hash
      await waitForApp(page, `/#pg=${pg.id}`)
      await page.waitForSelector('.tiptap', { timeout: 10000 })

      // Delete the image
      const img = page.locator('.tiptap img')
      await expect(img).toBeVisible({ timeout: 10000 })
      await img.click()
      await page.keyboard.press('Backspace')

      // Immediately undo (before the 2s debounce fires).
      // Use the toolbar Undo button rather than a keyboard shortcut — on mobile
      // the keyboard event can miss if the editor lost focus after Backspace.
      await page.getByRole('button', { name: 'Undo' }).click()

      // Wait for the saved page content to still reference this image.
      // Use generous timeout — the undo + re-save involves two debounce cycles.
      await waitForPageContent(
        client,
        pg.id,
        (content) => JSON.stringify(content).includes(storagePath),
        15000,
      )

      // Image should still exist after undo and autosave propagation.
      const exists = await waitForStorageFileExistence(client, storagePath, 10000)
      expect(exists).toBe(true)
    } finally {
      await cleanupStorageFile(client, storagePath)
    }
  })

  // ---------- T4: Page deletion with images → storage cleaned ----------
  test('T4: deleting a page cleans up its images from storage', async ({ page }) => {
    const { client, userId } = await getSupabase()
    const storagePath = await uploadTestImage(client, userId, `t4-${Date.now()}.png`)

    const nb = await createNotebook(client, userId, `T4 Notebook ${Date.now()}`)
    const sec = await createSection(client, userId, nb.id, 'T4 Section')
    const pg = await createPage(client, userId, sec.id, 'T4 Page', docWithImage(storagePath))

    try {
      // Navigate directly to the test page via hash
      await waitForApp(page, `/#pg=${pg.id}`)
      await page.waitForSelector('.tiptap', { timeout: 10000 })

      // Set up dialog handler to auto-accept the delete confirmation
      page.once('dialog', (dialog) => dialog.accept())

      // Click the delete button for the page (in editor header)
      const deleteButton = page.locator('.editor-header .ghost', { hasText: 'Delete' })
      await deleteButton.click()

      const pageDeleted = await waitForPageDeletion(client, pg.id)
      expect(pageDeleted).toBe(true)

      // Wait for page deletion + fire-and-forget storage cleanup
      const deleted = await waitForStorageFileDeletion(client, storagePath)
      expect(deleted).toBe(true)
    } finally {
      await cleanupStorageFile(client, storagePath)
    }
  })

  // ---------- T5: Section deletion with images → storage cleaned ----------
  test('T5: deleting a section cleans up images from all its pages', async ({ page }) => {
    const { client, userId } = await getSupabase()
    const storagePath1 = await uploadTestImage(client, userId, `t5a-${Date.now()}.png`)
    const storagePath2 = await uploadTestImage(client, userId, `t5b-${Date.now()}.png`)

    const nb = await createNotebook(client, userId, `T5 Notebook ${Date.now()}`)
    const sectionTitle = `T5 Section ${Date.now()}`
    const sec = await createSection(client, userId, nb.id, sectionTitle)
    await createPage(client, userId, sec.id, 'T5 Page 1', docWithImage(storagePath1, 'p1-img'))
    await createPage(client, userId, sec.id, 'T5 Page 2', docWithImage(storagePath2, 'p2-img'))

    try {
      await waitForApp(page)

      // Select the notebook via the navigation tree
      const notebookNode = page.locator('.tree-node-notebook', { hasText: nb.title })
      await notebookNode.click()

      // Set up dialog handler to auto-accept the delete confirmation
      page.once('dialog', (dialog) => dialog.accept())

      // Right-click the section node and delete it from the tree context menu
      const sectionNode = page.locator('.tree-node-section', { hasText: sectionTitle })
      await expect(sectionNode).toBeVisible({ timeout: 5000 })
      await sectionNode.click({ button: 'right' })
      await page.locator('.tree-context-menu').getByRole('button', { name: 'Delete' }).click()

      // Wait for section deletion + fire-and-forget storage cleanup
      const deleted1 = await waitForStorageFileDeletion(client, storagePath1)
      const deleted2 = await waitForStorageFileDeletion(client, storagePath2)
      expect(deleted1).toBe(true)
      expect(deleted2).toBe(true)
    } finally {
      await cleanupStorageFile(client, storagePath1)
      await cleanupStorageFile(client, storagePath2)
    }
  })

  // ---------- T6: Notebook deletion with images → storage cleaned ----------
  test('T6: deleting a notebook cleans up images from all contained pages', async ({ page }) => {
    const { client, userId } = await getSupabase()
    const storagePath = await uploadTestImage(client, userId, `t6-${Date.now()}.png`)

    const nb = await createNotebook(client, userId, `T6 Notebook ${Date.now()}`)
    const sectionTitle = `T6 Section ${Date.now()}`
    const sec = await createSection(client, userId, nb.id, sectionTitle)
    await createPage(client, userId, sec.id, 'T6 Page', docWithImage(storagePath))

    try {
      await waitForApp(page)

      // Select the notebook via the navigation tree
      const notebookNode = page.locator('.tree-node-notebook', { hasText: nb.title })
      await notebookNode.click()
      await expect(page.locator('.tree-node-section', { hasText: sectionTitle })).toBeVisible({ timeout: 5000 })

      // Set up dialog handler to auto-accept the delete confirmation
      page.once('dialog', (dialog) => dialog.accept())

      // Right-click the notebook node and delete it from the tree context menu
      await notebookNode.click({ button: 'right' })
      await page.locator('.tree-context-menu').getByRole('button', { name: 'Delete' }).click()

      // Wait for notebook deletion + fire-and-forget storage cleanup
      const deleted = await waitForStorageFileDeletion(client, storagePath)
      expect(deleted).toBe(true)
    } finally {
      await cleanupStorageFile(client, storagePath)
    }
  })

  // ---------- T7: deleteImagesFromStorage with empty array → no crash ----------
  test('T7: page without images can be deleted without errors', async ({ page }) => {
    const { client, userId } = await getSupabase()

    const nb = await createNotebook(client, userId, `T7 Notebook ${Date.now()}`)
    const sec = await createSection(client, userId, nb.id, 'T7 Section')
    const pg = await createPage(client, userId, sec.id, 'T7 Page', docWithoutImage())

    // Navigate directly to the test page via hash
    await waitForApp(page, `/#pg=${pg.id}`)
    await page.waitForSelector('.tiptap', { timeout: 10000 })

    // Set up dialog handler
    page.once('dialog', (dialog) => dialog.accept())

    // Delete page — should not crash (click delete in editor header)
    const deleteButton = page.locator('.editor-header .ghost', { hasText: 'Delete' })
    await deleteButton.click()

    const pageDeleted = await waitForPageDeletion(client, pg.id)
    expect(pageDeleted).toBe(true)

    // Page should be gone from the sidebar
    await expect(page.locator('text=T7 Page')).not.toBeVisible()
  })
})
